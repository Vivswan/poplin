// A whole account at the fake Cloudflare API, kept in memory: it answers every request the zone plug and an install send and applies each change, so a second run reads what the first one wrote.

import type { SqlValue } from "@poplin/core/src/database/driver";
import { EXAMPLE_ACCOUNT } from "../../worker/support/example-bindings";
import { type Asked, page, refusal, reply } from "./replies";

/** The account the install's Worker runs in. */
export const ACCOUNT = EXAMPLE_ACCOUNT;

/** A token of that account. */
export const TOKEN = "token-of-account-a-0123456789";

/** A valid token of another account, which has a zone of the same name. */
export const OTHER_TOKEN = "token-of-account-b-0123456789";

/** The key an install of that account keeps. As the kept key's rights have it, it reads the account and its zone, and is refused every change, the account's databases, and the account's tokens. */
export const KEPT = "kept-key-of-account-a-0123456789";

/** The install's zone. */
const ZONE = "zone-1";

/** The team domain of the account's Zero Trust organization. */
export const TEAM = "team.cloudflareaccess.com";

/** What Cloudflare answers on an account whose Access was never switched on. */
const ACCESS_OFF = { status: 403, code: 9999, message: "access.api.error.not_enabled" } as const;

/** What Cloudflare answers a cron trigger in an account that has no free address. */
const NO_SUBDOMAIN = { status: 403, code: 10063, message: "The account has no subdomain." } as const;

/** How the value of every key the fake makes starts. A test looks for it in whatever a run says: the value is no text of a row, a step, a log, or an error. */
export const KEY_VALUE_START = "value-of-made-key-";

/** The permission groups the fake lists, by scope: every right of a key, and the ones a key is kept from. One name is of both scopes, as at Cloudflare, the zone's first: found by its name alone, it is the wrong one. */
const GROUP_NAMES = {
  "com.cloudflare.api.account.zone": [
    ...["Access: Apps and Policies Write", "Zone Read", "Zone Settings Read", "DNS Read", "DNS Write", "Workers Routes Read", "Workers Routes Write"],
    ...["Zone WAF Write", "Dynamic URL Redirects Read", "Dynamic URL Redirects Write", "Bot Management Read", "Bot Management Write"],
  ],
  "com.cloudflare.api.account": ["Account Analytics Read", "Access: Apps and Policies Write", "Access: Organizations, Identity Providers, and Groups Read", "Notifications Write", "Workers Scripts Write", "Account API Tokens Write"],
  "com.cloudflare.edge.r2.bucket": ["Workers R2 Storage Bucket Item Read", "Workers R2 Storage Bucket Item Write"],
} as const;

/** Which account each token acts on. */
const ACCOUNT_OF: Readonly<Record<string, string>> = { [`Bearer ${TOKEN}`]: ACCOUNT, [`Bearer ${KEPT}`]: ACCOUNT, [`Bearer ${OTHER_TOKEN}`]: "account-b" };

/** What the kept key is refused beside every change: the paths of the account's databases and of its tokens. */
const KEPT_FROM = /\/(d1|tokens)(\/|$)/;

/** Every zone the fake holds, whatever the account. */
const ZONES = [
  { id: ZONE, name: "example.com", account: { id: ACCOUNT }, plan: { name: "Free Website" }, status: "active" },
  { id: "zone-b", name: "example.com", account: { id: "account-b" }, plan: { name: "Free Website" }, status: "active" },
];

/** The name of the account in its free address, and of the other account in its own. */
const FREE_ADDRESSES: Readonly<Record<string, string>> = { [ACCOUNT]: "example", "account-b": "other" };

/** A stored object: its id and whatever was sent for it. */
type Row = Record<string, unknown>;

/** How many keys the fake has made, over every account of a test run. */
let madeKeys = 0;

/** How many audience tags the fake has given out, so no two applications of a test run share one. */
let madeTags = 0;

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

  /** The account's identity providers: the login methods its Access offers. */
  methods: Row[];

  /** Whether Cloudflare makes the account no passkeys: a call to make that method is then refused, as a request it does not take. */
  noPasskeys?: boolean;

  /** The id of every application whose logins were ended, in order. */
  revoked: string[];

  /** The zone's entry point ruleset of each phase that has one, under the name it was made with. */
  rulesets: Record<string, { id: string; name: string; rules: Row[] } | undefined>;

  /** The zone's bot switches. */
  switches: Row;

  /** The account's D1 databases. */
  databases: Row[];

  /** What the database the Worker is bound to holds, asked through the query route with core's own statements; left out, the route answers the count of sites alone. */
  store?: { readonly call: (sql: string, params: readonly SqlValue[]) => Promise<readonly unknown[]> };

  /** The account's notification policies. */
  alerts: Row[];

  /** The account's Workflows. */
  workflows: Row[];

  /** The bindings of the install's Worker. */
  bindings: Row[];

  /** What the next reads of the Worker's settings answer in place of its own, each once and in order, as settings that trail a change do: at once, or from the Worker's next upload on. */
  trailing?: { from: "now" | "upload"; readonly answers: Row[] };

  /** What the next reads of a path answer in place of what the account holds, each once and in order, as a read that trails a write does: a list as its rows, anything else as the one object. */
  trails?: Record<string, unknown[]>;

  /** Whether the account has no Worker named `poplin`: every read of it is then answered 404, until an upload makes it. */
  noWorker?: boolean;

  /** Every upload of the install's Worker, in order: its metadata, and the name of each file sent with it. */
  uploads: Row[];

  /** The versions of the install's Worker, the latest first: an upload and a change of the settings each make one, with the annotations that call stated and no other, and the bindings the Worker had after it. */
  versions: Row[];

  /** The id of the version each deployment of the install's Worker runs, the newest first. */
  deployments: string[];

  /** The cron list of the install's Worker. */
  crons: string[];

  /** The observability of the install's Worker, as its last upload or a change of its script settings stated it. */
  observability: unknown;

  /** The two address switches of the install's Worker. */
  address: Row;

  /** The account's R2 buckets. */
  buckets: Row[];

  /** The objects of the bucket named `poplin-sites`, each with its key and its size. */
  objects: Row[];

  /** How many sites the database named `poplin` holds; left out, it has no table of sites, as one no Worker ever opened. */
  sites?: number;

  /** The tables the database named `poplin` holds; left out, the ones a Worker made where `sites` is given, and none else. `failed` answers the question for them as a statement the database did not run. */
  tables?: readonly string[] | "failed";

  /** Accounts the token shows beside its own. */
  alsoShown?: Row[];

  /** The account's name in its free address; `undefined` for an account that never set one, which is refused the read of it and every cron trigger. */
  subdomain: string | undefined;

  /** The names Cloudflare gives no account for a free address: a call that sets one of them is refused. */
  takenNames?: readonly string[];

  /** The account's other Workers, each with its tags, its bindings, and its two address switches. */
  workers: Row[];

  /** The API tokens the account owns: every key made for an install, as Cloudflare lists it, with no value. */
  tokens: Row[];

  /** The permission groups Cloudflare lists for the account. */
  groups: Row[];

  /** Whether the zone's own Always Use HTTPS is on. */
  zoneRedirects: boolean;

  /** Whether Access was never switched on: both Access lists are then refused. */
  accessOff: boolean;

  /** A call to refuse, as `METHOD /path`, or several; one that ends in `*` refuses every call that starts so. The refusal's message repeats the token it was sent with. */
  refuse?: string | readonly string[];

  /** The message of that refusal, for a test that needs Cloudflare's own words. */
  refuseMessage?: string;

  /** Whether that refusal's message also repeats everything the call sent, as an API that quotes a bad request does. */
  refuseQuotes?: boolean;

  /** The status and the error code of that refusal; left out, the ones of a token that lacks a permission. */
  refuseAs?: { readonly status: number; readonly code: number };

  /** How many more calls get that refusal, counted down by each; left out, every one does. */
  refuseTimes?: number;

  /** The `Retry-After` of that refusal, in seconds; left out, it names none. */
  refuseAfter?: number;
}

/** An account with nothing of poplin's in it and no hostnames of its own. */
export function emptyAccount(): Account {
  return {
    records: [],
    routes: [],
    policies: [],
    applications: [],
    methods: [{ id: "method-cloudflare", name: "Cloudflare", type: "cloudflare", config: {} }],
    revoked: [],
    rulesets: {},
    switches: { ai_bots_protection: "disabled", fight_mode: false },
    zoneRedirects: false,
    databases: [],
    alerts: [],
    workflows: [],
    bindings: [
      { name: "WORKER_NAME", type: "plain_text", text: "poplin" },
      { name: "SITES", type: "r2_bucket", bucket_name: "poplin-sites" },
      { name: "DB", type: "d1", id: "database-1" },
      { name: "ZONE", type: "json", json: { domain: "example.com" } },
    ],
    uploads: [],
    versions: [],
    deployments: [],
    crons: [],
    observability: { enabled: true, head_sampling_rate: 1, logs: { enabled: true, invocation_logs: false } },
    address: { enabled: false, previews_enabled: true },
    buckets: [],
    objects: [],
    subdomain: FREE_ADDRESSES[ACCOUNT],
    workers: [],
    accessOff: false,
    tokens: [],
    groups: Object.entries(GROUP_NAMES).flatMap(([scope, names]) => names.map((name) => ({ id: `${name} of ${scope}`, name, scopes: [scope] }))),
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
  if (asked.method === "DELETE" && index < 0) return refusal(404, 10007, "no such object");

  if (asked.method === "DELETE") list.splice(index, 1);
  else list[index] = { [key]: id, ...body };

  return reply({ [key]: id });
}

/** The zone's rulesets: the entry point of a phase, a new one with its first rules, the removal of one with whatever it holds, which is answered with no body, and the rules of one. */
function rules(account: Account, asked: Asked, parts: readonly string[]): Response {
  const body = (asked.body ?? {}) as Row;

  if (parts[3] === "phases") {
    const ruleset = account.rulesets[parts[4] ?? ""];

    return ruleset === undefined ? refusal(404, 10003, "could not find entrypoint ruleset in the phase") : reply(ruleset);
  }

  if (parts[3] === undefined) {
    const made = { id: `set-${body.phase}`, name: String(body.name), rules: (body.rules as Row[]).map((rule, index) => ({ id: `rule-${index}`, ...rule })) };
    account.rulesets[String(body.phase)] = made;

    return reply(made);
  }

  const [phase, ruleset] = Object.entries(account.rulesets).find(([, candidate]) => candidate?.id === parts[3]) ?? [];
  if (phase === undefined || ruleset === undefined) return refusal(404, 10003, "no such ruleset");

  if (parts[4] !== undefined) return stored(ruleset.rules, asked, parts[5]);

  if (asked.method !== "DELETE") return reply(ruleset);

  delete account.rulesets[phase];

  return new Response(null, { status: 204 });
}

/** The account's Access applications. Access gives each an audience tag of 64 hexadecimal characters, here the count of tags given out, and a change keeps the tag. A call to end an application's logins is answered 202 and noted. */
function applications(account: Account, asked: Asked, id: string | undefined, act: string | undefined): Response {
  if (act === "revoke_tokens") {
    if (id === undefined || !account.applications.some((application) => application.id === id)) return refusal(404, 12130, "access.api.error.not_found");

    account.revoked.push(id);

    return Response.json({ success: true, errors: [], messages: [], result: true }, { status: 202 });
  }

  const kept = asked.method === "PUT" ? account.applications.find((application) => application.id === id)?.aud : undefined;
  const answered = stored(account.applications, asked, id);

  for (const application of account.applications) {
    madeTags += 1;
    application.aud ??= kept ?? madeTags.toString(16).padStart(64, "0");
  }

  return answered;
}

/** The account's identity providers. Cloudflare takes one that mails a code an account, and a test may have it refuse passkeys. */
function methods(account: Account, asked: Asked, id: string | undefined): Response {
  const type = asked.method === "POST" ? ((asked.body ?? {}) as Row).type : undefined;
  if (type === "passkeys" && account.noPasskeys === true) return refusal(400, 12000, "access.api.error.invalid_request");

  if (type === "onetimepin" && account.methods.some((method) => method.type === type)) return refusal(409, 12001, "access.api.error.conflict: a onetimepin connection already exists");

  return stored(account.methods, asked, id);
}

/** Another Worker of the account: an upload makes it with the tags and bindings sent and Cloudflare's first addresses, and its settings and its address switches are read and set. */
function otherWorker(account: Account, asked: Asked, parts: readonly string[]): Response {
  const [name, part] = [parts[4], parts[5]];
  const at = account.workers.findIndex((candidate) => candidate.id === name);
  if (asked.method === "PUT" && part === undefined) {
    const { metadata } = asked.body as { readonly metadata: Row };
    account.workers.splice(at < 0 ? account.workers.length : at, 1, { enabled: false, previews_enabled: true, ...account.workers[at], id: name, tags: metadata.tags, bindings: metadata.bindings });

    return reply({ id: name });
  }

  const current = account.workers[at];
  if (current === undefined) return refusal(404, 10007, "This Worker does not exist on your account.");

  if (asked.method === "DELETE") {
    account.workers.splice(at, 1);

    return reply(null);
  }

  if (part === "settings") return reply({ bindings: current.bindings ?? [], tags: current.tags });

  if (asked.method === "POST") Object.assign(current, asked.body);

  return reply({ enabled: current.enabled, previews_enabled: current.previews_enabled });
}

/** The bindings of the install's Worker after a change: one it names as inherited is kept, each other is taken as sent, and every binding it does not name is dropped. A secret is kept and never read back, so its binding lists with no text. */
function boundAfter(account: Account, sent: readonly Row[]): Row[] {
  const taken = (binding: Row): Row => (binding.type === "secret_text" ? { name: binding.name, type: binding.type } : binding);

  return sent.flatMap((binding) => (binding.type === "inherit" ? account.bindings.filter((kept) => kept.name === binding.name) : [taken(binding)]));
}

/** A new latest version of the install's Worker, deployed at once: it carries the annotations of the call that made it, and none of the version before. */
function versioned(account: Account, annotations: Row | undefined): void {
  const number = account.versions.length + 1;
  account.versions.unshift({ id: `version-${number}`, number, annotations, bindings: account.bindings });
  account.deployments.unshift(`version-${number}`);
}

/** A deployment of an earlier version of the install's Worker: that version runs again, with the bindings it was made with. One the Worker has no such version for is refused. */
function deployed(account: Account, asked: Asked): Response {
  const id = (asked.body as { readonly versions: readonly { readonly version_id: string }[] }).versions[0]?.version_id;
  const version = account.versions.find((made) => made.id === id);
  if (version === undefined) return refusal(404, 10092, "Version not found.");

  account.deployments.unshift(version.id as string);
  account.bindings = version.bindings as Row[];

  return reply({ id: `deployment-${account.deployments.length}` });
}

/** The versions of the install's Worker: the list names each by its id and number alone, one read by its id answers its annotations, and a deployment runs a version again. */
function versions(account: Account, asked: Asked, parts: readonly string[]): Response {
  if (parts[5] === "deployments") return asked.method === "POST" ? deployed(account, asked) : reply({ deployments: account.deployments.map((id) => ({ versions: [{ version_id: id, percentage: 100 }] })) });

  if (parts[6] === undefined) return reply({ items: account.versions.map(({ id, number }) => ({ id, number })) });

  const version = account.versions.find((made) => made.id === parts[6]);

  return version === undefined ? refusal(404, 10092, "Version not found.") : reply({ id: version.id, number: version.number, annotations: version.annotations ?? {}, resources: {} });
}

/** An upload of the install's Worker: it makes the Worker where there is none, with Cloudflare's first addresses, and a new latest version with the annotations sent. */
function uploaded(account: Account, asked: Asked): Response {
  const { metadata, ...files } = asked.body as { readonly metadata: { readonly bindings: Row[]; readonly annotations?: Row; readonly observability?: unknown } };
  if (account.noWorker === true) account.bindings = [];

  account.noWorker = false;
  if (account.trailing !== undefined) account.trailing.from = "now";

  account.bindings = boundAfter(account, metadata.bindings);
  // Cloudflare keeps no observability across an upload: one that states none leaves the Worker with none.
  account.observability = metadata.observability;
  account.uploads.push({ metadata, files: Object.keys(files) });
  versioned(account, metadata.annotations);

  return reply({ id: "poplin" });
}

/** A change of the install's Worker as a whole: an upload, or a removal, with which its bindings, its versions, and its cron list go. */
function written(account: Account, asked: Asked): Response {
  if (asked.method === "PUT") return uploaded(account, asked);

  if (account.noWorker === true) return refusal(404, 10007, "This Worker does not exist on your account.");

  Object.assign(account, { noWorker: true, bindings: [], versions: [], deployments: [], crons: [] });

  return reply(null);
}

/** The settings a read of the install's Worker is answered: the next of the answers that trail a change, or else its bindings. */
function settingsOf(account: Account): Row {
  const trailing = account.trailing?.from === "now" ? account.trailing.answers.shift() : undefined;

  return trailing ?? { bindings: account.bindings, observability: account.observability };
}

/** The script settings of the install's Worker: its observability, read, or replaced by a change that states one. */
function scriptSettings(account: Account, asked: Asked): Response {
  if (asked.method === "PATCH") account.observability = (asked.body as { readonly observability?: unknown }).observability;

  return reply({ logpush: false, observability: account.observability ?? { enabled: false }, tags: [] });
}

/** The cron list of the install's Worker: read, or replaced by the one sent. Cloudflare takes no cron trigger in an account with no free address, also for a Worker that never answers under it. */
function schedules(account: Account, asked: Asked): Response {
  if (asked.method === "PUT" && account.subdomain === undefined) return refusal(NO_SUBDOMAIN.status, NO_SUBDOMAIN.code, NO_SUBDOMAIN.message);

  if (asked.method === "PUT") account.crons = (asked.body as { readonly cron: string }[]).map((schedule) => schedule.cron);

  return reply({ schedules: account.crons.map((cron) => ({ cron })) });
}

/** The account's Workers: the list, the Worker named `poplin` with its settings, its versions, its cron list, and its address switches, and every other Worker. */
function worker(account: Account, asked: Asked, parts: readonly string[]): Response {
  if (parts[4] === undefined) return page(asked, [{ id: "poplin", tags: [] }, ...account.workers]);

  if (parts[4] !== "poplin") return otherWorker(account, asked, parts);

  if (asked.method !== "GET" && parts[5] === undefined) return written(account, asked);

  if (account.noWorker === true) return refusal(404, 10007, "This Worker does not exist on your account.");

  if (parts[5] === "versions" || parts[5] === "deployments") return versions(account, asked, parts);

  if (parts[5] === "schedules") return schedules(account, asked);

  if (parts[5] === "subdomain") {
    if (asked.method === "POST") Object.assign(account.address, asked.body);

    return reply(account.address);
  }

  if (parts[5] === "script-settings") return scriptSettings(account, asked);

  if (parts[5] !== "settings") return refusal(404, 10007, "This Worker does not exist on your account.");

  if (asked.method === "GET") return reply(settingsOf(account));

  const { settings } = asked.body as { settings: { bindings: Row[]; annotations?: Row } };
  account.bindings = boundAfter(account, settings.bindings);
  versioned(account, settings.annotations);

  return reply({ bindings: account.bindings });
}

/** The objects of poplin's bucket: the list, and the removal of one by its key. Any other bucket holds none. */
function objects(account: Account, asked: Asked, name: string, key: string | undefined): Response {
  if (!account.buckets.some((bucket) => bucket.name === name)) return refusal(404, 10006, "The specified bucket does not exist.");

  if (name !== "poplin-sites") return reply([]);

  return key === undefined ? reply(account.objects) : stored(account.objects, asked, decodeURIComponent(key), "key");
}

/** The account's R2 buckets: the list, as one object that holds it, a new bucket of the name sent, a bucket's objects, and the removal of a bucket that holds none. */
function buckets(account: Account, asked: Asked, parts: readonly string[]): Response {
  const [name, part] = [parts[4], parts[5]];
  if (name !== undefined && part === "objects") return objects(account, asked, name, parts[6]);

  if (name !== undefined && asked.method === "DELETE") {
    if (name === "poplin-sites" && account.objects.length > 0) return refusal(409, 10008, "The bucket you tried to delete is not empty.");

    return stored(account.buckets, asked, name, "name");
  }

  if (asked.method === "POST") account.buckets.push({ ...(asked.body as Row) });

  return reply(asked.method === "POST" ? asked.body : { buckets: account.buckets });
}

/** The API tokens the account owns. A new one is active, and its value is answered this once and kept nowhere. No two tokens of a test run share an id. An expired one is listed only when the expired are asked for, as at Cloudflare. */
function tokens(account: Account, asked: Asked, id: string | undefined): Response {
  if (id === "permission_groups") return reply(account.groups);

  const every = id !== undefined || asked.method !== "GET" || asked.path.includes("include_expired=true");
  if (!every) return stored(account.tokens.filter((token) => token.status !== "expired"), asked, id);

  if (asked.method !== "POST") return stored(account.tokens, asked, id);

  madeKeys += 1;
  const made = { id: `key-${madeKeys}`, status: "active", ...(asked.body as Row) };
  account.tokens.push(made);

  return reply({ ...made, value: `${KEY_VALUE_START}${madeKeys}` });
}

/** The account's Workflows, each under its name: a PUT makes the one of a name, or writes it anew. */
function workflows(account: Account, asked: Asked, name: string | undefined): Response {
  if (asked.method === "GET") return page(asked, account.workflows);

  const kept = account.workflows.filter((workflow) => workflow.name !== name);
  account.workflows = asked.method === "DELETE" ? kept : [...kept, { name, ...(asked.body as Row) }];

  return reply({ name });
}

/** A question to the database: the names of its tables and the count of its sites are answered, and the test fails on anything that is no such read. */
function queried(account: Account, asked: Asked): Response {
  const { sql } = asked.body as { readonly sql: string };
  if (sql === "SELECT name FROM sqlite_master WHERE type = 'table'") {
    if (account.tables === "failed") return reply([{ results: [], success: false }]);

    const tables = account.tables ?? (account.sites === undefined ? [] : ["schema_steps", "sites"]);

    return reply([{ results: ["_cf_KV", ...tables].map((name) => ({ name })), success: true }]);
  }

  if (sql !== "SELECT count(*) AS sites FROM sites") throw new Error(`the fake database was asked something it has no answer for: ${sql}`);

  return account.sites === undefined ? refusal(400, 7500, "no such table: sites") : reply([{ results: [{ sites: account.sites }], success: true }]);
}

/** The zone's own switches: Always Use HTTPS, which is only read, and the bot switches. */
function switches(account: Account, asked: Asked, parts: readonly string[]): Response {
  if (parts[2] === "settings") return reply({ id: parts[3], value: account.zoneRedirects ? "on" : "off" });

  if (asked.method === "PUT") account.switches = { ...account.switches, ...(asked.body as Row) };

  return reply(account.switches);
}

/**
 * The query route of a database a test gave a store: the statements of one call joined by semicolons in `sql`, answered one result a statement from that store.
 * A statement that fails is a refusal with SQLite's own words, and nothing of the call is kept. A body of another shape is answered with no result, as at Cloudflare.
 */
async function storeQueried(account: Account, asked: Asked): Promise<Response> {
  const { sql, params } = (asked.body ?? {}) as { readonly sql?: unknown; readonly params?: readonly SqlValue[] };
  if (account.store === undefined) return refusal(404, 7404, "The database was not found");

  if (typeof sql !== "string") return reply([]);

  try {
    return reply(await account.store.call(sql, params ?? []));
  } catch (error) {
    return refusal(400, 7500, error instanceof Error ? error.message : "the statement failed");
  }
}

/** The account's free address: its name, read, or set to the one sent. An account with none is refused the read, a name Cloudflare gives no account is refused, and so is a call that names another account than the token's. */
function freeAddress(account: Account, asked: Asked, accountId: string | undefined): Response {
  if (accountId !== ACCOUNT) return refusal(403, 10000, "Authentication error");

  if (asked.method === "PUT") {
    const { subdomain } = asked.body as { readonly subdomain: string };
    if (account.takenNames?.includes(subdomain) === true) return refusal(409, 10031, "The subdomain is not available.");

    account.subdomain = subdomain;
  }

  return account.subdomain === undefined ? refusal(404, 10007, "The account has no subdomain.") : reply({ subdomain: account.subdomain });
}

/** Answer a request of the install's own account by the kind of object its path names. */
function inAccount(account: Account, asked: Asked, parts: readonly string[]): Response {
  const kind = parts.slice(2, 4).join("/");
  if (kind.startsWith("access/") && account.accessOff) return refusal(ACCESS_OFF.status, ACCESS_OFF.code, ACCESS_OFF.message);

  if (kind.startsWith("dns_records")) return stored(account.records, asked, parts[3]);

  if (kind.startsWith("workers/routes")) return stored(account.routes, asked, parts[4]);

  if (kind === "access/policies") return stored(account.policies, asked, parts[4]);

  if (kind === "access/apps") return applications(account, asked, parts[4], parts[5]);

  if (kind === "access/identity_providers") return methods(account, asked, parts[4]);

  if (kind === "access/organizations") return reply({ auth_domain: TEAM });

  if (kind === "workers/scripts") return worker(account, asked, parts);

  if (kind === "workers/subdomain") return freeAddress(account, asked, parts[1]);

  if (kind === "d1/database" && parts[5] === "query") return queried(account, asked);

  if (kind === "d1/database") return stored(account.databases, asked, parts[4], "uuid");

  if (kind === "r2/buckets") return buckets(account, asked, parts);

  if (kind === "alerting/v3") return stored(account.alerts, asked, parts[5]);

  if (parts[2] === "rulesets") return rules(account, asked, parts);

  if (parts[2] === "tokens") return tokens(account, asked, parts[3]);

  if (parts[2] === "workflows") return workflows(account, asked, parts[3]);

  return switches(account, asked, parts);
}

/** Whether a request was sent with the kept key and is one the key has no right to. */
function keptFrom(asked: Asked, path: string): boolean {
  return asked.key === `Bearer ${KEPT}` && (asked.method !== "GET" || KEPT_FROM.test(path));
}

/** Refuse a request the install's own account does not take from its sender: a token the fake does not know or of another account, the kept key where it has no right, and a call a test set to be refused. `undefined` for a request that is taken. */
function barred(account: Account, asked: Asked, path: string): Response | undefined {
  const owner = ACCOUNT_OF[asked.key ?? ""];
  if (owner === undefined) return refusal(401, 10000, "Authentication error");

  if (owner !== ACCOUNT || keptFrom(asked, path)) return refusal(403, 10000, "Authentication error");

  const call = `${asked.method} ${path}`;
  const refused = [account.refuse ?? []].flat().some((entry) => (entry.endsWith("*") ? call.startsWith(entry.slice(0, -1)) : entry === call));
  const quoted = account.refuseQuotes === true ? ` in ${JSON.stringify(asked.body)}` : "";

  if (!refused || account.refuseTimes === 0) return undefined;

  if (account.refuseTimes !== undefined) account.refuseTimes -= 1;

  const headers: Record<string, string> = account.refuseAfter === undefined ? {} : { "retry-after": String(account.refuseAfter) };

  return refusal(account.refuseAs?.status ?? 403, account.refuseAs?.code ?? 10000, account.refuseMessage ?? `Authentication error for ${asked.key}${quoted}`, headers);
}

/** The answer of a read a test set to trail a write: the next one kept for its path. */
function trailed(account: Account, asked: Asked, path: string): Response | undefined {
  const next = asked.method === "GET" ? account.trails?.[path]?.shift() : undefined;
  if (next === undefined) return undefined;

  return Array.isArray(next) ? page(asked, next) : reply(next);
}

/**
 * Answer one request as the account's API would.
 *
 * @returns the reply; a token the fake does not know is refused, and a known token sees only its own account and that account's zones
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

  if (path === "/accounts") return page(asked, [{ id: owner, name: "An account" }, ...(owner === ACCOUNT ? (account.alsoShown ?? []) : [])]);

  // A token of another account reads its own free address, and reaches nothing of this account.
  if (owner !== ACCOUNT && asked.method === "GET" && path === `/accounts/${owner}/workers/subdomain`) return reply({ subdomain: FREE_ADDRESSES[owner] });

  return barred(account, asked, path) ?? trailed(account, asked, path) ?? inAccount(account, asked, path.split("/").slice(1));
}

/**
 * Answer one call of the query route of an account whose database has a store, which is answered later than every other request.
 *
 * @returns the reply: a refusal as `answer` gives it, or one result a statement
 */
export async function answerQuery(account: Account, asked: Asked): Promise<Response> {
  const [path = ""] = asked.path.split("?");

  return barred(account, asked, path) ?? storeQueried(account, asked);
}
