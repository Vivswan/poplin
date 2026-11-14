// The requests: what each command asks for once its words are read, with every argument checked.

import { type Checked, type PublicName, parsePublicName, parseSiteName, type SiteName } from "../../../core/src/names/names";
import { siteReference } from "../../../core/src/sites/labels";
import type { CommandName } from "./command-table";
import { isSettingKey, readSetting, SETTING_SAMPLES, type SettingKey } from "./install-settings";
import { readSiteSettings, type SiteSettings } from "./site-settings";
import { type Flags, flagValue, isUsageError, looksLikePath, nearest, type UsageError, usageError } from "./util";

/** A version number as it is typed: a whole number from 1, with no sign and no leading zero. */
const VERSION_PATTERN = /^[1-9]\d*$/;

/** What a site argument may be, for the hint of a refused one. */
const SITE_FORMS = "a site is its label report--k3f9x2ab71qz, its id k3f9x2ab71qz, or a public site's public name";

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
};

/** The command of every request: each command of the table but `help`, which asks nothing of an install. */
const BUILDERS: { readonly [Name in Exclude<CommandName, "help">]: (words: Words, now: number) => Request | UsageError } = {
  publish,
  set,
  show: (words) => oneSite("show", words),
  rollback,
  "new-link": (words) => oneSite("new-link", words),
  delete: (words) => withSite(words, (site, install) => ({ kind: "delete", site, forever: words.flags.has("--forever"), ...install })),
  restore: (words) => oneSite("restore", words),
  list: (words) => withInstall(words, (install) => ({ kind: "list", trash: words.flags.has("--trash"), ...install })),
  login,
  logout: (words) => withInstall(words, (install) => ({ kind: "logout", ...install })),
  whoami: (words) => withInstall(words, (install) => ({ kind: "whoami", ...install })),
  setup: (words) => withInstall(words, (install) => ({ kind: "setup", ...install })),
  config,
  doctor: (words) => withInstall(words, (install) => ({ kind: "doctor", ...install })),
  export: exportSites,
  import: importBackup,
  mcp: () => ({ kind: "mcp" }),
};

type Refusal = Extract<Checked<unknown>, { readonly ok: false }>["refusal"];

/** What names a site: its label's name and id, its id alone, or a public name. No lookup has been made. */
type SiteRef = Extract<ReturnType<typeof siteReference>, { readonly ok: true }>["value"];

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

/** What `config` does: show every setting, show one, give one a value in core's text form, or put one back. */
type ConfigAction =
  | { readonly kind: "show-all" }
  | { readonly kind: "show"; readonly key: SettingKey }
  | { readonly kind: "change"; readonly key: SettingKey; readonly value: string }
  | { readonly kind: "reset"; readonly key: SettingKey };

/** A publish makes a new site, named after the path unless `name` is given, or updates the site it names. */
type PublishTarget = { readonly kind: "create"; readonly name?: SiteName } | { readonly kind: "update"; readonly site: SiteRef };

/** One command with its checked arguments. `path` and `zip` are as typed: no file has been read. */
export type Request =
  | ({ readonly kind: "publish"; readonly path: string; readonly target: PublishTarget; readonly settings: SiteSettings; readonly dryRun: boolean } & Install)
  | ({ readonly kind: "set"; readonly site: SiteRef; readonly settings: SiteSettings } & Install)
  | ({ readonly kind: "show" | "new-link" | "restore"; readonly site: SiteRef } & Install)
  | ({ readonly kind: "rollback"; readonly site: SiteRef; readonly to?: number } & Install)
  | ({ readonly kind: "delete"; readonly site: SiteRef; readonly forever: boolean } & Install)
  | ({ readonly kind: "list"; readonly trash: boolean } & Install)
  | ({ readonly kind: "login"; readonly publisher: boolean; readonly computer?: string; readonly browser: boolean } & Install)
  | ({ readonly kind: "logout" | "whoami" | "setup" | "doctor" } & Install)
  | ({ readonly kind: "config"; readonly action: ConfigAction } & Install)
  | ({ readonly kind: "export"; readonly site?: SiteRef; readonly allVersions: boolean; readonly out?: string; readonly overwrite: boolean } & Install)
  | ({ readonly kind: "import"; readonly zip: string; readonly site?: SiteRef; readonly settings: boolean; readonly logins: boolean; readonly dryRun: boolean } & Install)
  | { readonly kind: "mcp" };

function readInstall(flags: Flags): Install | UsageError {
  const json = flags.has("--json");
  const server = flagValue(flags, "--server");
  if (server === undefined) return { json };

  if (server === "") return usageError("--server needs the address of an install");

  return { json, server };
}

function readSite(raw: string, what: string): SiteRef | UsageError {
  if (looksLikePath(raw)) return usageError(`${JSON.stringify(raw)} is a path. Give the site's label; poplin list shows it.`);

  const reference = siteReference(raw);
  if (!reference.ok) return usageError(`${what} ${JSON.stringify(raw)} is not a site: ${REFUSALS[reference.refusal]}`, SITE_FORMS);

  return reference.value;
}

function readName<Name>(raw: string, parsed: Checked<Name>): Name | UsageError {
  if (!parsed.ok) return usageError(`--name ${JSON.stringify(raw)} is not a name: ${REFUSALS[parsed.refusal]}`);

  return parsed.value;
}

function readPublicName(raw: string): PublicName | UsageError {
  return readName(raw, parsePublicName(raw, NOTHING_RESERVED));
}

function withInstall(words: Words, build: (install: Install) => Request): Request | UsageError {
  const install = readInstall(words.flags);
  if (isUsageError(install)) return install;

  return build(install);
}

function withSite(words: Words, build: (site: SiteRef, install: Install) => Request): Request | UsageError {
  const site = readSite(words.positionals[0] ?? "", "<site>");
  if (isUsageError(site)) return site;

  return withInstall(words, (install) => build(site, install));
}

function oneSite(kind: "show" | "new-link" | "restore", words: Words): Request | UsageError {
  return withSite(words, (site, install) => ({ kind, site, ...install }));
}

/** The public name `--name` gives a site that `--public` makes public; without `--public` the flag has no meaning for an existing site. */
function publicNameOf(flags: Flags, settings: SiteSettings, refusal: UsageError): PublicName | undefined | UsageError {
  const name = flagValue(flags, "--name");
  if (name === undefined) return undefined;

  if (settings.access !== "public") return refusal;

  return readPublicName(name);
}

function withPublicName(settings: SiteSettings, publicName: PublicName | undefined): SiteSettings {
  if (publicName === undefined) return settings;

  return { ...settings, publicName };
}

/** Whether a publish creates or updates, and what `--name` means for it: the new site's name, and its public name once `--public` is given. */
function planPublish(flags: Flags, given: SiteSettings): { readonly target: PublishTarget; readonly settings: SiteSettings } | UsageError {
  const siteText = flagValue(flags, "--site");
  const nameText = flagValue(flags, "--name");

  if (siteText !== undefined) {
    const site = readSite(siteText, "--site");
    if (isUsageError(site)) return site;

    const renamed = usageError(
      "--site with --name is an error: a site's name is set once, when it is made",
      "to give the site a public name: --site <site> --public --name <public name>",
    );
    const publicName = publicNameOf(flags, given, renamed);
    if (isUsageError(publicName)) return publicName;

    return { target: { kind: "update", site }, settings: withPublicName(given, publicName) };
  }

  if (nameText === undefined) return { target: { kind: "create" }, settings: given };

  if (given.access === "public") {
    const name = readPublicName(nameText);
    if (isUsageError(name)) return name;

    return { target: { kind: "create", name }, settings: { ...given, publicName: name } };
  }

  const name = readName(nameText, parseSiteName(nameText));
  if (isUsageError(name)) return name;

  return { target: { kind: "create", name }, settings: given };
}

function publish(words: Words, now: number): Request | UsageError {
  const [path = ""] = words.positionals;
  if (path === "") return usageError("the path is empty", "to publish the current folder: poplin .");

  const given = readSiteSettings(words.flags, now);
  if (isUsageError(given)) return given;

  const plan = planPublish(words.flags, given);
  if (isUsageError(plan)) return plan;

  return withInstall(words, (install) => ({ kind: "publish", path, ...plan, dryRun: words.flags.has("--dry-run"), ...install }));
}

function set(words: Words, now: number): Request | UsageError {
  const given = readSiteSettings(words.flags, now);
  if (isUsageError(given)) return given;

  const unnamed = usageError("--name gives a public site its public name, so it needs --public", "poplin set <site> --public --name <public name>");
  const publicName = publicNameOf(words.flags, given, unnamed);
  if (isUsageError(publicName)) return publicName;

  if (Object.keys(given).length === 0) return usageError("nothing to change: poplin set needs at least one setting", "poplin help set lists them");

  return withSite(words, (site, install) => ({ kind: "set", site, settings: withPublicName(given, publicName), ...install }));
}

function rollback(words: Words): Request | UsageError {
  const to = flagValue(words.flags, "--to");
  if (to === undefined) return withSite(words, (site, install) => ({ kind: "rollback", site, ...install }));

  const version = Number(to);
  if (!VERSION_PATTERN.test(to) || !Number.isSafeInteger(version))
    return usageError(`--to takes a version number such as 4, not ${JSON.stringify(to)}`, "poplin show <site> lists the versions");

  return withSite(words, (site, install) => ({ kind: "rollback", site, to: version, ...install }));
}

function login(words: Words): Request | UsageError {
  const asked = { kind: "login", publisher: words.flags.has("--publisher"), browser: !words.flags.has("--no-browser") } as const;
  const computer = flagValue(words.flags, "--name");
  if (computer === undefined) return withInstall(words, (install) => ({ ...asked, ...install }));

  return withInstall(words, (install) => ({ ...asked, computer, ...install }));
}

function readConfigAction(words: Words): ConfigAction | UsageError {
  const [key, value] = words.positionals;
  const reset = words.flags.has("--reset");

  if (key === undefined && reset) return usageError("--reset needs the key to put back", "poplin config <key> --reset");

  if (key === undefined) return { kind: "show-all" };

  if (!isSettingKey(key)) {
    const meant = nearest(key, Object.keys(SETTING_SAMPLES));

    return usageError(`unknown setting ${JSON.stringify(key)}`, meant === undefined ? "poplin config shows every setting" : `did you mean ${meant}?`);
  }

  if (value !== undefined && reset) return usageError("--reset takes no value", `poplin config ${key} --reset`);

  if (reset) return { kind: "reset", key };

  if (value === undefined) return { kind: "show", key };

  if (readSetting(key, value) === undefined)
    return usageError(`${JSON.stringify(value)} is not a value of ${key}`, `for example: poplin config ${key} ${SETTING_SAMPLES[key]}`);

  return { kind: "change", key, value };
}

function config(words: Words): Request | UsageError {
  const action = readConfigAction(words);
  if (isUsageError(action)) return action;

  return withInstall(words, (install) => ({ kind: "config", action, ...install }));
}

function exportSites(words: Words): Request | UsageError {
  const out = flagValue(words.flags, "--out");
  if (out === "") return usageError("--out needs the path of the zip to write", "poplin export --out backup.zip");

  const asked = { allVersions: words.flags.has("--all-versions"), overwrite: words.flags.has("--overwrite"), ...(out === undefined ? {} : { out }) };
  const [siteText] = words.positionals;
  if (siteText === undefined) return withInstall(words, (install) => ({ kind: "export", ...asked, ...install }));

  return withSite(words, (site, install) => ({ kind: "export", site, ...asked, ...install }));
}

function importBackup(words: Words): Request | UsageError {
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
export function buildRequest(command: Exclude<CommandName, "help">, words: Words, now: number): Request | UsageError {
  return BUILDERS[command](words, now);
}
