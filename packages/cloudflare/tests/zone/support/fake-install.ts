// A whole account at the fake Cloudflare API, kept in memory: it answers every request the zone plug sends and applies each change, so a second run reads what the first one wrote.

import { EXAMPLE_ACCOUNT } from "../../worker/support/example-bindings";
import { type Asked, page, refusal, reply } from "./replies";

/** The account the install's Worker runs in. */
export const ACCOUNT = EXAMPLE_ACCOUNT;

/** A token of that account. */
export const TOKEN = "token-of-account-a-0123456789";

/** A valid token of another account, which has a zone of the same name. */
export const OTHER_TOKEN = "token-of-account-b-0123456789";

/** The install's zone. */
const ZONE = "zone-1";

/** The team domain of the account's Zero Trust organization. */
export const TEAM = "team.cloudflareaccess.com";

/** What Cloudflare answers on an account whose Access was never switched on. */
const ACCESS_OFF = { status: 403, code: 9999, message: "access.api.error.not_enabled" } as const;

/** Which account each token acts on. */
const ACCOUNT_OF: Readonly<Record<string, string>> = { [`Bearer ${TOKEN}`]: ACCOUNT, [`Bearer ${OTHER_TOKEN}`]: "account-b" };

/** Every zone the fake holds, whatever the account. */
const ZONES = [
  { id: ZONE, name: "example.com", account: { id: ACCOUNT }, plan: { name: "Free Website" }, status: "active" },
  { id: "zone-b", name: "example.com", account: { id: "account-b" }, plan: { name: "Free Website" }, status: "active" },
];

/** A stored object: its id and whatever was sent for it. */
type Row = Record<string, unknown>;

/** The account's state. A test changes it between runs to make an object missing or different. */
export interface Account {
  /** The zone's DNS records. */
  records: Row[];

  /** The zone's Worker routes. */
  routes: Row[];

  /** The account's reusable Access policies. */
  policies: Row[];

  /** The account's Access applications. */
  applications: Row[];

  /** The zone's entry point ruleset of each phase that has one. */
  rulesets: Record<string, { id: string; rules: Row[] } | undefined>;

  /** The zone's bot switches. */
  switches: Row;

  /** The account's D1 databases. */
  databases: Row[];

  /** The account's notification policies. */
  alerts: Row[];

  /** The bindings of the install's Worker. */
  bindings: Row[];

  /** Whether the zone's own Always Use HTTPS is on. */
  zoneRedirects: boolean;

  /** Whether Access was never switched on: both Access lists are then refused. */
  accessOff: boolean;

  /** A call to refuse, as `METHOD /path`, or several; the refusal's message repeats the token it was sent with. */
  refuse?: string | readonly string[];

  /** The message of that refusal, for a test that needs Cloudflare's own words. */
  refuseMessage?: string;

  /** The status and the error code of that refusal; left out, the ones of a token that lacks a permission. */
  refuseAs?: { readonly status: number; readonly code: number };
}

/** An account with nothing of poplin's in it and no hostnames of its own. */
export function emptyAccount(): Account {
  return {
    records: [],
    routes: [],
    policies: [],
    applications: [],
    rulesets: {},
    switches: { ai_bots_protection: "disabled", fight_mode: false },
    zoneRedirects: false,
    databases: [],
    alerts: [],
    bindings: [
      { name: "SITES", type: "r2_bucket", bucket_name: "poplin-sites" },
      { name: "DB", type: "d1", id: "database-1" },
      { name: "ZONE", type: "json", json: { domain: "example.com" } },
    ],
    accessOff: false,
  };
}

function stored(list: Row[], asked: Asked, id: string | undefined, key = "id"): Response {
  const body = (asked.body ?? {}) as Row;

  if (asked.method === "GET") return page(asked, list);

  if (asked.method === "POST") {
    const made = { [key]: `made-${list.length}`, ...body };
    list.push(made);

    return reply(made);
  }

  const index = list.findIndex((row) => row[key] === id);
  if (asked.method === "DELETE") list.splice(index, 1);
  else list[index] = { [key]: id, ...body };

  return reply({ [key]: id });
}

function rules(account: Account, asked: Asked, parts: readonly string[]): Response {
  const body = (asked.body ?? {}) as Row;

  if (parts[3] === "phases") {
    const ruleset = account.rulesets[parts[4] ?? ""];

    return ruleset === undefined ? refusal(404, 10003, "could not find entrypoint ruleset in the phase") : reply(ruleset);
  }

  if (parts[3] === undefined) {
    const made = { id: `set-${body.phase}`, rules: (body.rules as Row[]).map((rule, index) => ({ id: `rule-${index}`, ...rule })) };
    account.rulesets[String(body.phase)] = made;

    return reply(made);
  }

  const ruleset = Object.values(account.rulesets).find((candidate) => candidate?.id === parts[3]);
  if (ruleset === undefined) return refusal(404, 10003, "no such ruleset");

  return stored(ruleset.rules, asked, parts[5]);
}

/** The account's Access applications. Access gives each an audience tag of 64 hexadecimal characters, here made from its place in the list. */
function applications(account: Account, asked: Asked, id: string | undefined): Response {
  const answered = stored(account.applications, asked, id);
  for (const [index, application] of account.applications.entries()) application.aud ??= String(index + 1).padStart(64, "0");

  return answered;
}

/** The settings of the Worker named `poplin`: a change keeps a binding it names as inherited, takes each other as sent, and drops every binding it does not name. */
function worker(account: Account, asked: Asked, parts: readonly string[]): Response {
  if (parts[4] !== "poplin" || parts[5] !== "settings") return refusal(404, 10007, "This Worker does not exist on your account.");

  if (asked.method === "GET") return reply({ bindings: account.bindings });

  const { settings } = asked.body as { settings: { bindings: Row[] } };
  account.bindings = settings.bindings.flatMap((sent) => (sent.type === "inherit" ? account.bindings.filter((kept) => kept.name === sent.name) : [sent]));

  return reply({ bindings: account.bindings });
}

/** The zone's own switches: Always Use HTTPS, which is only read, and the bot switches. */
function switches(account: Account, asked: Asked, parts: readonly string[]): Response {
  if (parts[2] === "settings") return reply({ id: parts[3], value: account.zoneRedirects ? "on" : "off" });

  if (asked.method === "PUT") account.switches = { ...account.switches, ...(asked.body as Row) };

  return reply(account.switches);
}

/** Answer a request of the install's own account by the kind of object its path names. */
function inAccount(account: Account, asked: Asked, parts: readonly string[]): Response {
  const kind = parts.slice(2, 4).join("/");
  if (kind.startsWith("access/") && account.accessOff) return refusal(ACCESS_OFF.status, ACCESS_OFF.code, ACCESS_OFF.message);

  if (kind.startsWith("dns_records")) return stored(account.records, asked, parts[3]);

  if (kind.startsWith("workers/routes")) return stored(account.routes, asked, parts[4]);

  if (kind === "access/policies") return stored(account.policies, asked, parts[4]);

  if (kind === "access/apps") return applications(account, asked, parts[4]);

  if (kind === "access/organizations") return reply({ auth_domain: TEAM });

  if (kind === "workers/scripts") return worker(account, asked, parts);

  if (kind === "d1/database") return stored(account.databases, asked, parts[4], "uuid");

  if (kind === "alerting/v3") return stored(account.alerts, asked, parts[5]);

  if (parts[2] === "rulesets") return rules(account, asked, parts);

  return switches(account, asked, parts);
}

/**
 * Answer one request as the account's API would.
 *
 * @returns the reply; a token the fake does not know is refused, and a known token sees only the zones of its own account
 */
export function answer(account: Account, asked: Asked): Response {
  const owner = ACCOUNT_OF[asked.key ?? ""];
  if (owner === undefined) return refusal(401, 10000, "Authentication error");

  const [path = ""] = asked.path.split("?");
  if (path === "/zones")
    return page(
      asked,
      ZONES.filter((zone) => zone.account.id === owner),
    );

  // A token of another account reaches nothing of this one.
  if (owner !== ACCOUNT) return refusal(403, 10000, "Authentication error");

  if ([account.refuse ?? []].flat().includes(`${asked.method} ${path}`)) return refusal(account.refuseAs?.status ?? 403, account.refuseAs?.code ?? 10000, account.refuseMessage ?? `Authentication error for ${asked.key}`);

  return inAccount(account, asked, path.split("/").slice(1));
}
