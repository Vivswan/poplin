// The requests: what each command asks for once its words are read, with every argument checked.

import { type Checked, parsePublicName, parseSiteName, type SiteName } from "../../../core/src/names/names";
import { isPlainVersion } from "../../../core/src/records/update";
import { readSiteReference, type SettledSite, type TypedSite } from "../../../core/src/sites/references";
import type { CommandName } from "./command-table";
import { isSettingKey, readSetting, SETTING_SAMPLES, type SettingKey } from "./install-settings";
import { readSiteSettings, type SiteSettings } from "./site-settings";
import { type Flags, flagValue, isUsageError, looksLikePath, nearest, type UsageError, usageError } from "./util";

/** A version number as it is typed: a whole number from 1, with no sign and no leading zero. */
const VERSION_PATTERN = /^[1-9]\d*$/;

/** What a site argument may be, for the hint of a refused one. */
const SITE_FORMS = "a site is its label report--k3f9x2ab71qz, its id k3f9x2ab71qz, a public site's public name, or its address";

/** The names the parser keeps back: which ones an install keeps depends on its address layout, so the install answers for them. */
const NOTHING_RESERVED: ReadonlySet<string> = new Set();

/** Why core refused a name or a site, in words. A refusal missing here does not compile. */
const REFUSALS: Readonly<Record<Refusal, string>> = {
  empty: "it is empty",
  "too-short": "a name has at least 3 characters",
  "too-long": "a name has at most 40 characters",
  "bad-character": "a name holds lowercase letters, digits, and single dashes",
  "leading-dash": "a name does not start with a dash",
  "trailing-dash": "a name does not end with a dash",
  "double-dash": "a name holds single dashes only",
  reserved: "the install keeps that name for itself",
  "bad-id": "the part after the two dashes is not an id of 12 lowercase letters and digits",
  "no-site-url": "it is an address, but not a site's, such as https://report--k3f9x2ab71qz-p-poplin.example.com",
  "no-site-address": "it is not the address of a site, such as report--k3f9x2ab71qz-p-poplin.example.com",
};

/** The options of `poplin doctor` that mean something in a repair alone. */
const REPAIR_ALONE = ["--add-user", "--yes", "--token-stdin"] as const;

/** The command of every request: each command of the table but `help`, which asks nothing of an install. */
const BUILDERS: { readonly [Name in Exclude<CommandName, "help">]: (words: Words, now: number) => TypedRequest | UsageError } = {
  publish,
  set,
  show: (words) => oneSite("show", words),
  rollback,
  "new-link": (words) => oneSite("new-link", words),
  duplicate,
  delete: (words) => withSite(words, (site, install) => ({ kind: "delete", site, noTrash: words.flags.has("--no-trash"), ...install })),
  restore: (words) => oneSite("restore", words),
  list: (words) => withInstall(words, (install) => ({ kind: "list", trash: words.flags.has("--trash"), ...install })),
  login,
  logout: (words) => withInstall(words, (install) => ({ kind: "logout", ...install })),
  whoami: (words) => withInstall(words, (install) => ({ kind: "whoami", ...install })),
  config,
  doctor,
  update,
  export: exportSites,
  import: importBackup,
  mcp: () => ({ kind: "mcp" }),
};

type Refusal = Extract<ReturnType<typeof readSiteReference>, { readonly ok: false }>["refusal"];

/** What every command that talks to an install carries: whether to answer in JSON, and the install `--server` chose. */
interface Install {
  readonly json: boolean;
  readonly server?: string;
}

/** The words of one command after its own name: the arguments in order, and the flags. */
interface Words {
  readonly positionals: readonly string[];
  readonly flags: Flags;
}

/** What `config` does: show every setting, show one, or give one a value in core's text form. */
type ConfigAction = { readonly kind: "show-all" } | { readonly kind: "show"; readonly key: SettingKey } | { readonly kind: "change"; readonly key: SettingKey; readonly value: string };

/** What `update` does: take the newest release or the one version `to` names, or say what a start would come to. */
type UpdateAction = { readonly kind: "start"; readonly to?: string } | { readonly kind: "check" };

/** A publish makes a new site, named after the path unless `name` is given, or updates the site it names. */
type PublishTarget<Site> = { readonly kind: "create"; readonly name?: SiteName } | { readonly kind: "update"; readonly site: Site };

/**
 * One command with its checked arguments. `path` and `zip` are as typed: no file has been read.
 *
 * `Site` is what names a site: its label's name and id, its id alone, or a public name, with the domain of an address that was typed. No lookup has been made.
 */
type Asked<Site> =
  | ({ readonly kind: "publish"; readonly path: string; readonly target: PublishTarget<Site>; readonly settings: SiteSettings; readonly dryRun: boolean } & Install)
  | ({ readonly kind: "set"; readonly site: Site; readonly settings: SiteSettings } & Install)
  | ({ readonly kind: "show" | "new-link" | "restore"; readonly site: Site } & Install)
  | ({ readonly kind: "rollback"; readonly site: Site; readonly to?: number } & Install)
  | ({ readonly kind: "duplicate"; readonly site: Site; readonly name?: SiteName } & Install)
  | ({ readonly kind: "delete"; readonly site: Site; readonly noTrash: boolean } & Install)
  | ({ readonly kind: "list"; readonly trash: boolean } & Install)
  | ({ readonly kind: "login"; readonly publisher: boolean; readonly computer?: string; readonly browser: boolean } & Install)
  | ({ readonly kind: "logout" | "whoami" | "doctor" } & Install)
  | ({ readonly kind: "config"; readonly action: ConfigAction } & Install)
  | ({ readonly kind: "update"; readonly action: UpdateAction } & Install)
  | ({ readonly kind: "export"; readonly site?: Site; readonly allVersions: boolean; readonly out?: string; readonly overwrite: boolean } & Install)
  | ({ readonly kind: "import"; readonly zip: string; readonly site?: Site; readonly settings: boolean; readonly logins: boolean; readonly dryRun: boolean } & Install)
  | { readonly kind: "mcp" };

/** A command as the parser read it: the site it names may be an address only its install can read. */
export type TypedRequest = Asked<TypedSite>;

/** A command whose site, when it names one, is read: what every command runs on. */
export type Request = Asked<SettledSite>;

function readInstall(flags: Flags): Install | UsageError {
  const json = flags.has("--json");
  const server = flagValue(flags, "--server");
  if (server === undefined) return { json };

  if (server === "") return usageError("--server needs the address of an install");

  return { json, server };
}

function readSite(raw: string, what: string): TypedSite | UsageError {
  const reference = readSiteReference(raw);
  if (reference.ok) return reference.value;

  // An address holds a slash and a dot as a path does, so a path is one only once it read as no site, and never when a scheme was typed.
  if (reference.refusal !== "no-site-url" && looksLikePath(raw)) return usageError(`${JSON.stringify(raw)} is a path. Give the site's label; poplin list shows it.`);

  return usageError(`${what} ${JSON.stringify(raw)} is not a site: ${REFUSALS[reference.refusal]}`, SITE_FORMS);
}

function readName<Name>(flag: "--name" | "--public-name", raw: string, parsed: Checked<Name>): Name | UsageError {
  if (!parsed.ok) return usageError(`${flag} ${JSON.stringify(raw)} is not a name: ${REFUSALS[parsed.refusal]}`);

  return parsed.value;
}

function withInstall(words: Words, build: (install: Install) => TypedRequest): TypedRequest | UsageError {
  const install = readInstall(words.flags);
  if (isUsageError(install)) return install;

  return build(install);
}

function withSite(words: Words, build: (site: TypedSite, install: Install) => TypedRequest): TypedRequest | UsageError {
  const site = readSite(words.positionals[0] ?? "", "<site>");
  if (isUsageError(site)) return site;

  return withInstall(words, (install) => build(site, install));
}

function oneSite(kind: "show" | "new-link" | "restore", words: Words): TypedRequest | UsageError {
  return withSite(words, (site, install) => ({ kind, site, ...install }));
}

/**
 * Add the names the flags give to the settings: `--name`, the site's own, and `--public-name`, the one in its public address.
 *
 * @returns the settings, or why a name is none; `--public-name` without `--public` has no meaning
 */
function withNames(flags: Flags, given: SiteSettings): SiteSettings | UsageError {
  const [nameText, publicText] = [flagValue(flags, "--name"), flagValue(flags, "--public-name")];
  const name = nameText === undefined ? undefined : readName("--name", nameText, parseSiteName(nameText));
  if (isUsageError(name)) return name;

  if (publicText !== undefined && given.access !== "public") {
    return usageError("--public-name gives a public site its public name, so it needs --public", "poplin set <site> --public --public-name <public name>");
  }

  const publicName = publicText === undefined ? undefined : readName("--public-name", publicText, parsePublicName(publicText, NOTHING_RESERVED));
  if (isUsageError(publicName)) return publicName;

  return { ...given, ...(name === undefined ? {} : { name }), ...(publicName === undefined ? {} : { publicName }) };
}

/** Whether a publish creates or updates. `--name` is the new site's name, and the new name of a site that is updated. */
function planPublish(flags: Flags, given: SiteSettings): { readonly target: PublishTarget<TypedSite>; readonly settings: SiteSettings } | UsageError {
  const siteText = flagValue(flags, "--site");
  const named = withNames(flags, given);
  if (isUsageError(named)) return named;

  if (siteText !== undefined) {
    const site = readSite(siteText, "--site");
    if (isUsageError(site)) return site;

    return { target: { kind: "update", site }, settings: named };
  }

  const { name, ...settings } = named;
  if (name === undefined) return { target: { kind: "create" }, settings };

  return { target: { kind: "create", name }, settings };
}

function publish(words: Words, now: number): TypedRequest | UsageError {
  const [path = ""] = words.positionals;
  if (path === "") return usageError("the path is empty", "to publish the current folder: poplin .");

  const given = readSiteSettings(words.flags, now);
  if (isUsageError(given)) return given;

  const plan = planPublish(words.flags, given);
  if (isUsageError(plan)) return plan;

  return withInstall(words, (install) => ({ kind: "publish", path, ...plan, dryRun: words.flags.has("--dry-run"), ...install }));
}

function set(words: Words, now: number): TypedRequest | UsageError {
  const given = readSiteSettings(words.flags, now);
  if (isUsageError(given)) return given;

  const settings = withNames(words.flags, given);
  if (isUsageError(settings)) return settings;

  if (Object.keys(settings).length === 0) return usageError("nothing to change: poplin set needs at least one setting", "poplin help set lists them");

  return withSite(words, (site, install) => ({ kind: "set", site, settings, ...install }));
}

function rollback(words: Words): TypedRequest | UsageError {
  const to = flagValue(words.flags, "--to");
  if (to === undefined) return withSite(words, (site, install) => ({ kind: "rollback", site, ...install }));

  const version = Number(to);
  if (!VERSION_PATTERN.test(to) || !Number.isSafeInteger(version))
    return usageError(`--to takes a version number such as 4, not ${JSON.stringify(to)}`, "poplin show <site> lists the versions");

  return withSite(words, (site, install) => ({ kind: "rollback", site, to: version, ...install }));
}

function duplicate(words: Words): TypedRequest | UsageError {
  const nameText = flagValue(words.flags, "--name");
  if (nameText === undefined) return withSite(words, (site, install) => ({ kind: "duplicate", site, ...install }));

  const name = readName("--name", nameText, parseSiteName(nameText));
  if (isUsageError(name)) return name;

  return withSite(words, (site, install) => ({ kind: "duplicate", site, name, ...install }));
}

function login(words: Words): TypedRequest | UsageError {
  const asked = { kind: "login", publisher: words.flags.has("--publisher"), browser: !words.flags.has("--no-browser") } as const;
  const computer = flagValue(words.flags, "--name");
  if (computer === undefined) return withInstall(words, (install) => ({ ...asked, ...install }));

  return withInstall(words, (install) => ({ ...asked, computer, ...install }));
}

/** A check of the install with this computer's login. The options of a repair are refused here: a line that carries `--repair` is read by the repair's own parser and never comes this far. */
function doctor(words: Words): TypedRequest | UsageError {
  if (words.flags.has("--dry-run")) return usageError("poplin doctor changes nothing already: --dry-run goes with --repair");

  const stray = REPAIR_ALONE.find((flag) => words.flags.has(flag));
  if (stray !== undefined) return usageError(`${stray} goes with --repair`);

  return withInstall(words, (install) => ({ kind: "doctor", ...install }));
}

function readConfigAction(words: Words): ConfigAction | UsageError {
  const [key, value] = words.positionals;
  if (key === undefined) return { kind: "show-all" };

  if (!isSettingKey(key)) {
    const meant = nearest(key, Object.keys(SETTING_SAMPLES));

    return usageError(`unknown setting ${JSON.stringify(key)}`, meant === undefined ? "poplin config shows every setting" : `did you mean ${meant}?`);
  }

  if (value === undefined) return { kind: "show", key };

  if (readSetting(key, value) === undefined)
    return usageError(`${JSON.stringify(value)} is not a value of ${key}`, `for example: poplin config ${key} ${SETTING_SAMPLES[key]}`);

  return { kind: "change", key, value };
}

function config(words: Words): TypedRequest | UsageError {
  const action = readConfigAction(words);
  if (isUsageError(action)) return action;

  return withInstall(words, (install) => ({ kind: "config", action, ...install }));
}

function update(words: Words): TypedRequest | UsageError {
  const to = flagValue(words.flags, "--to");
  if (to !== undefined && !isPlainVersion(to)) return usageError("--to takes a version, such as 0.2.0", "poplin update --to 0.2.0");

  if (words.flags.has("--dry-run")) {
    if (to !== undefined) return usageError("--dry-run starts nothing, so it takes no --to", "poplin update --dry-run");

    return withInstall(words, (install) => ({ kind: "update", action: { kind: "check" }, ...install }));
  }

  return withInstall(words, (install) => ({ kind: "update", action: to === undefined ? { kind: "start" } : { kind: "start", to }, ...install }));
}

function exportSites(words: Words): TypedRequest | UsageError {
  const out = flagValue(words.flags, "--out");
  if (out === "") return usageError("--out needs the path of the zip to write", "poplin export --out backup.zip");

  const asked = { allVersions: words.flags.has("--all-versions"), overwrite: words.flags.has("--overwrite"), ...(out === undefined ? {} : { out }) };
  const [siteText] = words.positionals;
  if (siteText === undefined) return withInstall(words, (install) => ({ kind: "export", ...asked, ...install }));

  return withSite(words, (site, install) => ({ kind: "export", site, ...asked, ...install }));
}

function importBackup(words: Words): TypedRequest | UsageError {
  const [zip = ""] = words.positionals;
  if (zip === "") return usageError("the path of the zip is empty", "poplin import <zip>");

  const settings = words.flags.has("--settings");
  const logins = words.flags.has("--logins");
  if (logins && !settings) return usageError("--logins replaces the logins among the settings, so it needs --settings", "poplin import <zip> --settings --logins");

  const asked = { zip, settings, logins, dryRun: words.flags.has("--dry-run") };
  const siteText = flagValue(words.flags, "--site");
  if (siteText === undefined) return withInstall(words, (install) => ({ kind: "import", ...asked, ...install }));

  const site = readSite(siteText, "--site");
  if (isUsageError(site)) return site;

  return withInstall(words, (install) => ({ kind: "import", site, ...asked, ...install }));
}

/**
 * Build the request of one command from the words after its name.
 *
 * @param words - the arguments, already counted against the command's table entry, and the flags, already checked against it
 * @param now - the time, in milliseconds since the epoch; an expiry must lie after it
 * @returns the request, or the first argument or flag value that was written wrong
 */
export function buildRequest(command: Exclude<CommandName, "help">, words: Words, now: number): TypedRequest | UsageError {
  return BUILDERS[command](words, now);
}
