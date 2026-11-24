// The requests: what each command asks for once its words are read, with every argument checked.

import { type Checked, parsePublicName, parseSiteName, type SiteName } from "../../../../core/src/names/names";
import { settingFromText } from "../../../../core/src/records/settings";
import { isPlainVersion } from "../../../../core/src/records/update";
import { readSiteReference, type SettledSite, type TypedSite } from "../../../../core/src/sites/references";
import type { CommandName } from "../command-table";
import { isSettingKey, SETTING_SAMPLES, type SettingKey } from "../install/install-settings";
import { readSiteSettings, type SiteSettings } from "../sites/site-settings";
import { type Flags, flagValue, isUsageError, looksLikePath, nearest, type UsageError, usageError } from "./util";

/** A version number as it is typed: a whole number from 1, with no sign and no leading zero. */
const VERSION_PATTERN = /^[1-9]\d*$/;

/** What a site argument may be, for the hint of a refused one. */
const SITE_FORMS = "A site is a label (report--k3f9x2ab71qz), an id (k3f9x2ab71qz), a public name, or a URL.";

/** The names the parser keeps back: which ones an install keeps depends on its address layout, so the install answers for them. */
const NOTHING_RESERVED: ReadonlySet<string> = new Set();

/** Why core refused a name or a site, in words. A refusal missing here does not compile. */
const REFUSALS: Readonly<Record<Refusal, string>> = {
  empty: "it is empty",
  "too-short": "the minimum is 3 characters",
  "too-long": "the maximum is 40 characters",
  "bad-character": "only lowercase letters, digits, and single dashes are allowed",
  "leading-dash": "it starts with a dash",
  "trailing-dash": "it ends with a dash",
  "double-dash": "it has two dashes in a row",
  reserved: "the install reserves that name",
  "bad-id": "the part after -- is not an id of 12 lowercase letters and digits",
  "no-site-url": "it is a URL, but not a site URL such as https://report--k3f9x2ab71qz-p-poplin.example.com",
  "no-site-address": "it is not a site URL such as report--k3f9x2ab71qz-p-poplin.example.com",
};

/** The flag that asks what a command would do, with nothing changed. */
const DRY_RUN = "--dry-run";

/** The options of `poplin doctor` that mean something in a repair alone. */
const REPAIR_ALONE = ["--update", "--add-user", "--yes", "--token-stdin", "--all-permissions"] as const;

/** The command of every request: each command of the table but `help`, which asks nothing of an install. */
const BUILDERS: { readonly [Name in Exclude<CommandName, "help">]: (words: Words, now: number) => TypedRequest | UsageError } = {
  publish,
  set,
  show: (words) => oneSite("show", words),
  rollback,
  "new-link": (words) => rehearsable("new-link", words),
  duplicate,
  delete: (words) => withSite(words, (site, install) => ({ kind: "delete", site, noTrash: words.flags.has("--no-trash"), dryRun: words.flags.has(DRY_RUN), ...install })),
  restore: (words) => rehearsable("restore", words),
  list: (words) => withInstall(words, (install) => ({ kind: "list", trash: words.flags.has("--trash"), ...install })),
  login,
  logout: (words) => withInstall(words, (install) => ({ kind: "logout", dryRun: words.flags.has(DRY_RUN), ...install })),
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
type ConfigAction = { readonly kind: "show-all" } | { readonly kind: "show"; readonly key: SettingKey } | { readonly kind: "change"; readonly key: SettingKey; readonly value: string; readonly dryRun: boolean };

/** What `update` does: take the newest release or the one version `to` names, or say what a start would come to. */
type UpdateAction = { readonly kind: "start"; readonly to?: string } | { readonly kind: "check" };

/** A publish makes a new site, named after the path unless `name` is given, or updates the site it names. */
type PublishTarget<Site> = { readonly kind: "create"; readonly name?: SiteName } | { readonly kind: "update"; readonly site: Site };

/**
 * One command with its checked arguments. `path` and `zip` are as typed: no file has been read. `dryRun` is whether the command only says what it would do.
 *
 * `Site` is what names a site: its label's name and id, its id alone, or a public name, with the domain of an address that was typed. No lookup has been made.
 */
type Asked<Site> =
  | ({ readonly kind: "publish"; readonly path: string; readonly target: PublishTarget<Site>; readonly settings: SiteSettings; readonly dryRun: boolean } & Install)
  | ({ readonly kind: "set"; readonly site: Site; readonly settings: SiteSettings; readonly dryRun: boolean } & Install)
  | ({ readonly kind: "show"; readonly site: Site } & Install)
  | ({ readonly kind: "new-link"; readonly site: Site; readonly dryRun: boolean } & Install)
  | ({ readonly kind: "restore"; readonly site: Site; readonly dryRun: boolean } & Install)
  | ({ readonly kind: "rollback"; readonly site: Site; readonly to?: number; readonly dryRun: boolean } & Install)
  | ({ readonly kind: "duplicate"; readonly site: Site; readonly name?: SiteName; readonly dryRun: boolean } & Install)
  | ({ readonly kind: "delete"; readonly site: Site; readonly noTrash: boolean; readonly dryRun: boolean } & Install)
  | ({ readonly kind: "list"; readonly trash: boolean } & Install)
  | ({ readonly kind: "login"; readonly publisher: boolean; readonly computer?: string; readonly browser: boolean } & Install)
  | ({ readonly kind: "logout"; readonly dryRun: boolean } & Install)
  | ({ readonly kind: "whoami" | "doctor" } & Install)
  | ({ readonly kind: "config"; readonly action: ConfigAction } & Install)
  | ({ readonly kind: "update"; readonly action: UpdateAction } & Install)
  | ({ readonly kind: "export"; readonly site?: Site; readonly allVersions: boolean; readonly out?: string; readonly overwrite: boolean } & Install)
  | ({ readonly kind: "import"; readonly zip: string; readonly site?: Site; readonly settings: boolean; readonly users: boolean; readonly dryRun: boolean } & Install)
  | { readonly kind: "mcp" };

/** A command as the parser read it: the site it names may be an address only its install can read. */
export type TypedRequest = Asked<TypedSite>;

/** A command whose site, when it names one, is read: what every command runs on. */
export type Request = Asked<SettledSite>;

function readInstall(flags: Flags): Install | UsageError {
  const json = flags.has("--json");
  const server = flagValue(flags, "--server");
  if (server === undefined) return { json };

  if (server === "") return usageError("--server requires an install URL");

  return { json, server };
}

function readSite(raw: string, what: string): TypedSite | UsageError {
  const reference = readSiteReference(raw);
  if (reference.ok) return reference.value;

  // An address holds a slash and a dot as a path does, so a path is one only once it read as no site, and never when a scheme was typed.
  if (reference.refusal !== "no-site-url" && looksLikePath(raw)) return usageError(`${JSON.stringify(raw)} is a path, not a site. See: poplin list`);

  return usageError(`Invalid ${what} ${JSON.stringify(raw)}: ${REFUSALS[reference.refusal]}`, SITE_FORMS);
}

function readName<Name>(flag: "--name" | "--public-name", raw: string, parsed: Checked<Name>): Name | UsageError {
  if (!parsed.ok) return usageError(`Invalid ${flag} ${JSON.stringify(raw)}: ${REFUSALS[parsed.refusal]}`);

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

function oneSite(kind: "show", words: Words): TypedRequest | UsageError {
  return withSite(words, (site, install) => ({ kind, site, ...install }));
}

/** A command that changes one site and takes nothing else but whether it is a dry run. */
function rehearsable(kind: "new-link" | "restore", words: Words): TypedRequest | UsageError {
  return withSite(words, (site, install) => ({ kind, site, dryRun: words.flags.has(DRY_RUN), ...install }));
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
    return usageError("--public-name requires --public", "Usage: poplin set <site> --public --public-name <public name>");
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
  if (path === "") return usageError("The path is empty", "To publish the current folder: poplin .");

  const given = readSiteSettings(words.flags, now);
  if (isUsageError(given)) return given;

  const plan = planPublish(words.flags, given);
  if (isUsageError(plan)) return plan;

  return withInstall(words, (install) => ({ kind: "publish", path, ...plan, dryRun: words.flags.has(DRY_RUN), ...install }));
}

function set(words: Words, now: number): TypedRequest | UsageError {
  const given = readSiteSettings(words.flags, now);
  if (isUsageError(given)) return given;

  const settings = withNames(words.flags, given);
  if (isUsageError(settings)) return settings;

  if (Object.keys(settings).length === 0) return usageError("poplin set requires at least one setting", "See: poplin set --help");

  return withSite(words, (site, install) => ({ kind: "set", site, settings, dryRun: words.flags.has(DRY_RUN), ...install }));
}

function rollback(words: Words): TypedRequest | UsageError {
  const to = flagValue(words.flags, "--to");
  const dryRun = words.flags.has(DRY_RUN);
  if (to === undefined) return withSite(words, (site, install) => ({ kind: "rollback", site, dryRun, ...install }));

  const version = Number(to);
  if (!VERSION_PATTERN.test(to) || !Number.isSafeInteger(version))
    return usageError(`--to requires a version number such as 4, got ${JSON.stringify(to)}`, "See: poplin show <site>");

  return withSite(words, (site, install) => ({ kind: "rollback", site, to: version, dryRun, ...install }));
}

function duplicate(words: Words): TypedRequest | UsageError {
  const nameText = flagValue(words.flags, "--name");
  const dryRun = words.flags.has(DRY_RUN);
  if (nameText === undefined) return withSite(words, (site, install) => ({ kind: "duplicate", site, dryRun, ...install }));

  const name = readName("--name", nameText, parseSiteName(nameText));
  if (isUsageError(name)) return name;

  return withSite(words, (site, install) => ({ kind: "duplicate", site, name, dryRun, ...install }));
}

function login(words: Words): TypedRequest | UsageError {
  const asked = { kind: "login", publisher: words.flags.has("--publisher"), browser: !words.flags.has("--no-browser") } as const;
  const computer = flagValue(words.flags, "--machine");
  if (computer === undefined) return withInstall(words, (install) => ({ ...asked, ...install }));

  return withInstall(words, (install) => ({ ...asked, computer, ...install }));
}

/** A check of the install with this computer's login. The options of a repair are refused here: a line that carries `--repair` is read by the repair's own parser and never comes this far. */
function doctor(words: Words): TypedRequest | UsageError {
  if (words.flags.has(DRY_RUN)) return usageError("--dry-run requires --repair");

  const stray = REPAIR_ALONE.find((flag) => words.flags.has(flag));
  if (stray !== undefined) return usageError(`${stray} requires --repair`);

  return withInstall(words, (install) => ({ kind: "doctor", ...install }));
}

function readConfigAction(words: Words): ConfigAction | UsageError {
  const [key, value] = words.positionals;
  const dryRun = words.flags.has(DRY_RUN);
  if (dryRun && value === undefined) return usageError("--dry-run requires a <value>", "Usage: poplin config <key> <value> --dry-run");

  if (key === undefined) return { kind: "show-all" };

  if (!isSettingKey(key)) {
    const meant = nearest(key, Object.keys(SETTING_SAMPLES));

    return usageError(`Unknown setting ${JSON.stringify(key)}`, meant === undefined ? "See: poplin config" : `Did you mean ${meant}?`);
  }

  if (value === undefined) return { kind: "show", key };

  if (settingFromText(key, value) === undefined)
    return usageError(`Invalid value ${JSON.stringify(value)} for ${key}`, `Usage: poplin config ${key} ${SETTING_SAMPLES[key]}`);

  return { kind: "change", key, value, dryRun };
}

function config(words: Words): TypedRequest | UsageError {
  const action = readConfigAction(words);
  if (isUsageError(action)) return action;

  return withInstall(words, (install) => ({ kind: "config", action, ...install }));
}

function update(words: Words): TypedRequest | UsageError {
  const to = flagValue(words.flags, "--to");
  if (to !== undefined && !isPlainVersion(to)) return usageError("--to requires a version such as 0.2.0", "Usage: poplin update --to <version>");

  if (words.flags.has(DRY_RUN)) {
    if (to !== undefined) return usageError("--dry-run and --to are mutually exclusive", "Usage: poplin update --dry-run");

    return withInstall(words, (install) => ({ kind: "update", action: { kind: "check" }, ...install }));
  }

  return withInstall(words, (install) => ({ kind: "update", action: to === undefined ? { kind: "start" } : { kind: "start", to }, ...install }));
}

function exportSites(words: Words): TypedRequest | UsageError {
  const out = flagValue(words.flags, "--out");
  if (out === "") return usageError("--out requires a file path", "Usage: poplin export --out <file>");

  const asked = { allVersions: words.flags.has("--all-versions"), overwrite: words.flags.has("--overwrite"), ...(out === undefined ? {} : { out }) };
  const [siteText] = words.positionals;
  if (siteText === undefined) return withInstall(words, (install) => ({ kind: "export", ...asked, ...install }));

  return withSite(words, (site, install) => ({ kind: "export", site, ...asked, ...install }));
}

function importBackup(words: Words): TypedRequest | UsageError {
  const [zip = ""] = words.positionals;
  if (zip === "") return usageError("The zip path is empty", "Usage: poplin import <zip>");

  const settings = words.flags.has("--settings");
  const users = words.flags.has("--users");
  if (users && !settings) return usageError("--users requires --settings", "Usage: poplin import <zip> --settings --users");

  const asked = { zip, settings, users, dryRun: words.flags.has(DRY_RUN) };
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
