// The MCP tools: each site action as a tool an agent calls. A tool builds the request its command's parser would, and runs it with the command's own functions.

import { resolve } from "node:path";
import type * as v from "valibot";

import type { TOOL_INPUTS } from "../../../core/src/actions/tool-inputs";
import { parsePublicName, parseSiteName } from "../../../core/src/names/names";
import { readSiteReference, type TypedSite } from "../../../core/src/sites/references";
import { type Problem, problem } from "../commands/problems";
import { planPublish, sendPublish } from "../commands/publish";
import type { Outcome, RequestOf, Session } from "../commands/records";
import { removeForGood, runSiteCommand } from "../commands/site-commands";
import { readSiteSettings, type SiteSettings } from "../commands/site-settings";
import { isUsageError } from "../commands/util";
import { readByInstall, siteWord } from "../commands/wire";
import type { Host } from "./records";

/** What a `site` argument may be, for the hint of a refused one. */
const SITE_FORMS = "a site is the label a publish answered, such as report--k3f9x2ab71qz, its id k3f9x2ab71qz, a public site's public name, or its address (url)";

/** The names this machine keeps back: which ones an install keeps depends on its address layout, so the install answers for them. */
const NOTHING_RESERVED: ReadonlySet<string> = new Set();

/** The words the settings flags take for a switch. */
const SWITCH = { on: "on", off: "off" } as const;

/** What to do about a missing login. The server reads the login anew on every call, so the next call finds it. */
const HOW_TO_LOG_IN = "run `poplin login --server <address>` on this computer";

/** What every tool says of its `site`. */
const SITE = "Its label, e.g. report--k3f9x2ab71qz. Also taken: its bare id, its address (url), or a public site's public name.";

/** What `publish_site` and `update_site` say of each setting. */
const SETTINGS = {
  name: "A new name, e.g. q3-report. Renaming never breaks a link.",
  access: "private: only the owner. unlisted: anyone with the address. public: everyone. E.g. unlisted.",
  public_name: "With access public: the public address's name, e.g. docs. Left out: kept, or the site's name.",
  title: "Its title on the dashboard, e.g. Q3 sales. null: the page's own title.",
  search_engines: "true: search engines may list it once it is public.",
  embeddable: "false: other pages cannot show it in a frame or load its files.",
  expires: "When it moves to the trash: 7d (units s, m, h, d), 2026-12-01, or never.",
} as const;

/** The name of a tool: core lists them, one per site action. */
export type ToolName = keyof typeof TOOL_INPUTS;

/** What a tool is called with, once the server has checked it against core's schema. */
type InputOf<Name extends ToolName> = v.InferOutput<(typeof TOOL_INPUTS)[Name]>;

/** The settings a tool may be asked for, as the API names them. */
type AskedSettings = Omit<InputOf<"update_site">, "site">;

/** What names a site, as a command runs on it. */
type SiteReference = RequestOf<"show">["site"];

/** What a publish does, as a command runs on it: it makes a new site, or updates one. */
type Target = RequestOf<"publish">["target"];

/** A command about one or all sites, as `runSiteCommand` takes it. */
type SiteRequest = Parameters<typeof runSiteCommand>[0];

/**
 * One tool.
 *
 * `parameters` says of each argument which forms it takes, with an example; an argument without a line does not compile.
 * `hints` tell the agent's app whether the tool only reads, and whether it can destroy.
 */
interface Tool<Name extends ToolName> {
  readonly description: string;
  readonly parameters: Readonly<Record<keyof InputOf<Name>, string>>;
  readonly hints: { readonly readOnlyHint?: boolean; readonly destructiveHint?: boolean };
  readonly run: (input: InputOf<Name>, host: Host) => Promise<Outcome> | Outcome;
}

function refused(said: Problem): Outcome {
  return { ok: false, problem: said };
}

function isProblem(value: object): value is Problem {
  return "exit" in value;
}

function readSite(raw: string): TypedSite | Problem {
  const reference = readSiteReference(raw);
  if (!reference.ok) return problem("bad_argument", `site ${JSON.stringify(raw)}`, SITE_FORMS);

  return reference.value;
}

/** Read the names a tool was asked for: the site's own, and the one in its public address. */
function readNames(asked: Pick<AskedSettings, "name" | "public_name">): Pick<SiteSettings, "name" | "publicName"> | Problem {
  const name = asked.name === undefined ? undefined : parseSiteName(asked.name);
  if (name?.ok === false) return problem("bad_name", "name");

  const publicName = asked.public_name === undefined ? undefined : parsePublicName(asked.public_name, NOTHING_RESERVED);
  if (publicName?.ok === false) return problem("bad_name", "public_name");

  return { ...(name === undefined ? {} : { name: name.value }), ...(publicName === undefined ? {} : { publicName: publicName.value }) };
}

/** Read the settings a tool was asked for with the reader of the settings flags, so a tool and a command take the same values. */
function readSettings(asked: AskedSettings): SiteSettings | Problem {
  const flags = new Map<string, string | true>();

  if (asked.access !== undefined) flags.set(`--${asked.access}`, true);

  if (asked.title !== undefined) flags.set("--title", asked.title ?? "");

  if (asked.search_engines !== undefined) flags.set("--search-engines", asked.search_engines ? SWITCH.on : SWITCH.off);

  if (asked.embeddable !== undefined) flags.set("--embeddable", asked.embeddable ? SWITCH.on : SWITCH.off);

  if (asked.expires !== undefined) flags.set("--expires", asked.expires);

  const settings = readSiteSettings(flags, Date.now());
  if (isUsageError(settings)) return problem("bad_argument", settings.message, settings.hint);

  const names = readNames(asked);
  if (isProblem(names)) return names;

  return { ...settings, ...names };
}

/** Run one call against the install, or say why there is no install to call. */
async function online(host: Host, run: (session: Session) => Promise<Outcome>): Promise<Outcome> {
  const session = await host.session();

  if (session === "logged-out") {
    return refused({ ...problem("no_login"), hint: HOW_TO_LOG_IN });
  }

  if ("code" in session) return refused(session);

  return run(session);
}

/** Run one call about a site, read as the install reads it. A site typed as the address of another install, or as an address that is no site's of this one, is refused before the call. */
async function withSite(host: Host, typed: TypedSite, run: (site: SiteReference, session: Session) => Promise<Outcome>): Promise<Outcome> {
  return online(host, async (session) => {
    const site = await readByInstall(typed, session);

    return isProblem(site) ? refused(site) : run(site, session);
  });
}

async function onSite(host: Host, raw: string, request: (site: SiteReference) => SiteRequest): Promise<Outcome> {
  const typed = readSite(raw);
  if (isProblem(typed)) return refused(typed);

  return withSite(host, typed, (site, session) => runSiteCommand(request(site), session));
}

/** Remove a site for good, in the command's own words. The command asks a person to type the label first; a tool is asked through `no_trash: true` alone. */
async function deleteForever(raw: string, host: Host): Promise<Outcome> {
  const typed = readSite(raw);
  if (isProblem(typed)) return refused(typed);

  return withSite(host, typed, (site, session) => removeForGood(siteWord(site), session));
}

/** Whether a publish makes a new site, under which name, or updates one, which a name sent with it renames. `unread` updates a site whose address only the install can read. */
function readTarget(site: string | undefined, name: string | undefined): Target | { readonly kind: "unread"; readonly address: TypedSite } | Problem {
  if (site !== undefined) {
    const typed = readSite(site);
    if (isProblem(typed)) return typed;

    return typed.kind === "address" ? { kind: "unread", address: typed } : { kind: "update", site: typed };
  }

  if (name === undefined) return { kind: "create" };

  const parsed = parseSiteName(name);
  if (!parsed.ok) return problem("bad_name", "name");

  return { kind: "create", name: parsed.value };
}

/** Plan a publish and send it. The plan comes first, so a path that cannot be read is said with no install called. */
async function sendPlanned(host: Host, target: Target, plan: (to: Target) => ReturnType<typeof planPublish>): Promise<Outcome> {
  const planned = await plan(target);
  if (!planned.ok) return planned;

  if (target.kind === "create") return online(host, (session) => sendPublish(planned.plan, session));

  return withSite(host, target.site, (_site, session) => sendPublish(planned.plan, session));
}

/** Update the site an address names: the install reads the address first, since the plan holds the site it reads as. */
async function sendToAddress(host: Host, address: TypedSite, plan: (to: Target) => ReturnType<typeof planPublish>): Promise<Outcome> {
  return withSite(host, address, async (site, session) => {
    const planned = await plan({ kind: "update", site });

    return planned.ok ? sendPublish(planned.plan, session) : planned;
  });
}

async function publish(input: InputOf<"publish_site">, host: Host): Promise<Outcome> {
  const { path: asked, site, name, ...changes } = input;
  if (asked === "") return refused(problem("bad_argument", "path", "the path is empty; the server's working directory is ."));

  const target = readTarget(site, name);
  if (isProblem(target)) return refused(target);

  const settings = readSettings(site === undefined || name === undefined ? changes : { ...changes, name });
  if (isProblem(settings)) return refused(settings);

  const path = resolve(asked);
  const plan = (to: Target): ReturnType<typeof planPublish> => planPublish({ kind: "publish", path, target: to, settings, dryRun: false, json: false }, host.stopped);
  const sent = await (target.kind === "unread" ? sendToAddress(host, target.address, plan) : sendPlanned(host, target, plan));
  if (!sent.ok) return sent;

  return { ...sent, value: { ...Object(sent.value), path }, lines: [`read ${path}`, ...sent.lines] };
}

/** Every tool: what it tells an agent, and how it runs. */
export const TOOLS: { readonly [Name in ToolName]: Tool<Name> } = {
  publish_site: {
    description:
      "Publish a folder or one HTML file from this machine and answer the site with its address (url). " +
      "Without site it ALWAYS makes a new site: keep the label it answers and pass it as site to update that site later. " +
      "A new site is private: ask the user before access unlisted or public. Hidden files and node_modules are never uploaded.",
    parameters: {
      path: "A folder with an index.html, or one .html file, e.g. ./report. Relative to the server's working directory; the answer names the absolute path read.",
      site: "To update: the label an earlier publish answered, e.g. report--k3f9x2ab71qz, or its address (url). Left out: a new site.",
      ...SETTINGS,
      name: "The site's name, e.g. q3-report: 3 to 40 lowercase letters, digits, single dashes. New site, left out: the folder or file name. With site: renames it.",
    },
    hints: { destructiveHint: false },
    run: publish,
  },
  update_site: {
    description: "Change a site's settings; one left out stays as it is. Ask the user before access unlisted or public.",
    parameters: { site: SITE, ...SETTINGS },
    hints: { destructiveHint: false },
    run: ({ site, ...asked }, host) => {
      const settings = readSettings(asked);
      if (isProblem(settings)) return refused(settings);

      return onSite(host, site, (reference) => ({ kind: "set", site: reference, settings, json: false }));
    },
  },
  get_site: {
    description: "Show one site: its address (url), access, settings, kept versions, and about how often its pages were opened (views: estimates, not exact).",
    parameters: { site: SITE },
    hints: { readOnlyHint: true },
    run: (input, host) => onSite(host, input.site, (site) => ({ kind: "show", site, json: false })),
  },
  list_sites: {
    description: "List the sites, each with its label, access, and address (url); views in the data are about how often its pages were opened.",
    parameters: { trash: "true: list the deleted sites restore_site can still take back." },
    hints: { readOnlyHint: true },
    run: (input, host) => online(host, (session) => runSiteCommand({ kind: "list", trash: input.trash, json: false }, session)),
  },
  rollback_site: {
    description: "Make an earlier kept version of a site the live one. Its settings and addresses stay.",
    parameters: { site: SITE, version: "The version to go to, e.g. 3; get_site lists them. Left out: one back." },
    hints: { destructiveHint: false },
    run: (input, host) => onSite(host, input.site, (site) => ({ kind: "rollback", site, to: input.version, json: false })),
  },
  new_link: {
    description:
      "Give a site a new id, so a new label and address, when its address reached someone it should not have. " +
      "The old label and address stop working at once: use the label it answers from then on. A public site keeps its public address.",
    parameters: { site: SITE },
    hints: { destructiveHint: true },
    run: (input, host) => onSite(host, input.site, (site) => ({ kind: "new-link", site, json: false })),
  },
  delete_site: {
    description:
      "Move a site to the trash, where restore_site can take it back until the day the answer names. " +
      "With no_trash: true the site and every file of it are removed at once and nothing can restore them: only when the user asked for exactly that.",
    parameters: { site: SITE, no_trash: "true: remove the site now and for good, with no trash. Left out: it goes to the trash." },
    hints: { destructiveHint: true },
    run: (input, host) => {
      if (input.no_trash === true) return deleteForever(input.site, host);

      return onSite(host, input.site, (site) => ({ kind: "delete", site, noTrash: false, json: false }));
    },
  },
  duplicate_site: {
    description: "Make a private copy of a site, with a new label and address, titled as the site with (copy) after it. The original is untouched.",
    parameters: { site: SITE, name: "The copy's name, e.g. q3-draft. Left out: the site's own name." },
    hints: { destructiveHint: false },
    run: (input, host) => {
      if (input.name === undefined) return onSite(host, input.site, (site) => ({ kind: "duplicate", site, json: false }));

      const name = parseSiteName(input.name);
      if (!name.ok) return refused(problem("bad_name", "name"));

      return onSite(host, input.site, (site) => ({ kind: "duplicate", site, name: name.value, json: false }));
    },
  },
  restore_site: {
    description: "Take a site back out of the trash, with the settings it had.",
    parameters: { site: SITE },
    hints: { destructiveHint: false },
    run: (input, host) => onSite(host, input.site, (site) => ({ kind: "restore", site, json: false })),
  },
};
