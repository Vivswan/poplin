// The client reads whatever an address answers, which may be no install at all. No answer may make a command crash, be read as a done call it is not, or be thrown at the user.

import { afterAll, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";

import { type Called, type Client, createClient } from "../../packages/cli/src/client/client";
import type { Io } from "../../packages/cli/src/commands/records";
import { run } from "../../packages/cli/src/commands/run";
import { ABANDONED_UPLOAD } from "../../packages/core/src/actions/abandon-publish";
import { BEGUN_LOGIN_ANSWER, REDEEMED_LOGIN } from "../../packages/core/src/actions/computer-logins";
import { DELETED_SITE } from "../../packages/core/src/actions/delete";
import { DUPLICATED_SITE } from "../../packages/core/src/actions/duplicate";
import { EXPORTED_FILES, EXPORTED_SETTINGS, EXPORTED_SITE, EXPORTED_SITES } from "../../packages/core/src/actions/export";
import { PUBLISHED_SITE } from "../../packages/core/src/actions/finish-publish";
import { LISTED_SITES } from "../../packages/core/src/actions/list";
import { REVOKED_TOKEN, WHOAMI_ANSWER } from "../../packages/core/src/actions/manage-tokens";
import { ISSUED_TICKETS } from "../../packages/core/src/actions/issue-tickets";
import { SHOWN_UPLOAD } from "../../packages/core/src/actions/show-upload";
import { SITE_ANSWER } from "../../packages/core/src/actions/site-object";
import { STARTED_UPDATE } from "../../packages/core/src/actions/start-update";
import { SETTINGS_ANSWER } from "../../packages/core/src/actions/store-settings";
import { UPDATE_STATE } from "../../packages/core/src/actions/update";
import { BEGUN_UPLOAD } from "../../packages/core/src/actions/uploads";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const SERVER = "https://poplin.example.com";
const TOKEN = `poplin_${"0".repeat(16)}_${"a".repeat(64)}`;
const CRASHED = "poplin failed in a way it has no word for";
const EXIT_CODES = [0, 1, 5];
const STATUSES = [200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 409, 412, 413, 429, 500, 502, 503];
const SCRATCH = mkdtempSync(join(tmpdir(), "poplin-fuzz-"));
const FOLDER = join(SCRATCH, "report");
const SITE = {
  id: "k3f9x2ab71qz",
  label: "report--k3f9x2ab71qz",
  name: "report",
  public_name: null,
  title: null,
  title_typed: false,
  access: "private",
  url: "https://report--k3f9x2ab71qz-p-poplin.example.com",
  addresses: { site: "https://report--k3f9x2ab71qz-p-poplin.example.com", public: null },
  search_engines: false,
  embeddable: true,
  expires: "never",
  versions: [{ number: 1, published: 0, published_by: "0000000000000000" }],
  live_version: 1,
  bytes: 1,
  files: 1,
  updated: 0,
  state: "live",
  views: null,
};
const UPLOAD = { id: "0123456789abcdef", state: "pending", version: 1, files: 1, bytes: 1, expires: 0 };
const ADMIN = { id: "0000000000000000", scope: "admin", note: "", created: 0, expires: "never" };
const PARAM = { site: SITE.label, upload: UPLOAD.id };
const TICKET = { path: "index.html", url: `/api/uploads/${UPLOAD.id}/file?path=index.html`, method: "PUT", headers: { "Content-Type": "application/octet-stream", "Content-Length": "1" }, expires: 0 } as const;
const NEAR_ANSWERS: readonly unknown[] = [
  {},
  [],
  null,
  { error: { code: "not_found", message: "there is no such thing here" } },
  { error: { code: "missing_files", message: "a declared file has not been uploaded", about: "index.html" } },
  { error: { code: "upload_finished", message: "the upload is finished and live" } },
  { error: { code: 404, message: null } },
  { error: "not_found" },
  { site: SITE, before: null },
  { site: { ...SITE, created: true }, before: null, left: [] },
  { site: null, before: SITE, left: [] },
  { site: { ...SITE, versions: "many" }, before: null },
  { sites: [SITE], next: { updated_at: 1, id: "k3f9x2ab71qz" } },
  { sites: [SITE, null] },
  { token: ADMIN },
  { token: { ...ADMIN, scope: "owner" } },
  { token: ADMIN, version: "1.4.0" },
  { code: "ABCD-EFGH", secret: "a-secret", expires_in: 600, interval: 5, verify_url: "https://poplin.example.com/tokens/review/0123456789abcdef" },
  { state: "pending" },
  { state: "allowed", token: "a-token" },
  { site: null, before: null, copy: { upload: UPLOAD.id, copied: 0, files: 1 } },
  { upload: UPLOAD },
  { upload: UPLOAD, tickets: [TICKET] },
  { upload: UPLOAD, tickets: [{ ...TICKET, method: "DELETE" }] },
  { tickets: [TICKET, { ...TICKET, path: "gone.css" }] },
  { tickets: [{ path: "index.html", url: 7 }] },
  { upload: UPLOAD, missing: ["index.html", "gone.css"], more: false },
  { upload: { id: "0123456789abcdef", state: "pending" }, missing: "index.html", more: "no" },
  { path: "index.html", size: 1 },
  { files: [{ path: "index.html", size: 1 }] },
  { format: 1, settings: {} },
  { format: 1, sites: [], next: SITE.id },
  { format: 1, site: { id: SITE.id, name: SITE.name, live_version: 1, versions: [{ number: 1, files: 1, bytes: 1 }] } },
  { started: true, from: "1.4.0", to: null },
  { version: "1.4.0", update: null, key: "yes" },
  { values: { versions_kept: "many" } },
  { left: [] },
  { left: [1, 2, 3] },
  JSON.parse('{"__proto__":{"site":1},"constructor":{"prototype":{}},"site":null}'),
];
const COMMAND_LINES = [
  [FOLDER],
  [FOLDER, "--site", "report--k3f9x2ab71qz", "--json"],
  ["set", "report--k3f9x2ab71qz", "--public", "--search-engines", "on"],
  ["show", "k3f9x2ab71qz"],
  ["list"],
  ["list", "--trash", "--json"],
  ["rollback", "report", "--to", "2"],
  ["new-link", "report--k3f9x2ab71qz"],
  ["delete", "report--k3f9x2ab71qz"],
  ["delete", "report--k3f9x2ab71qz", "--forever"],
  ["restore", "report--k3f9x2ab71qz", "--json"],
  ["whoami"],
  ["logout"],
  ["config"],
  ["config", "trash_days"],
  ["config", "trash_days", "9", "--json"],
  ["doctor"],
];

const CALLS: readonly ((client: Client) => Promise<Called<unknown>>)[] = [
  (client) => client.call(WHOAMI_ANSWER, (api) => api.whoami.$get({ query: {} })),
  (client) => client.call(REVOKED_TOKEN, (api) => api.token.$delete({ query: {} })),
  (client) => client.call(BEGUN_LOGIN_ANSWER, (api) => api.logins.$post({ query: {}, json: { scope: "publisher", computer: "laptop" } })),
  (client) => client.call(REDEEMED_LOGIN, (api) => api.logins.token.$post({ query: {}, json: { secret: "a-secret" } })),
  (client) => client.call(LISTED_SITES, (api) => api.sites.$get({ query: { trash: "true", limit: "50" } })),
  (client) => client.call(SITE_ANSWER, (api) => api.sites[":site"].$get({ param: PARAM, query: {} })),
  (client) => client.call(DELETED_SITE, (api) => api.sites[":site"].$delete({ param: PARAM, query: { forever: "true" } })),
  (client) => client.call(DUPLICATED_SITE, (api) => api.sites[":site"].duplicate.$post({ param: PARAM, query: {}, json: {} })),
  (client) => client.call(BEGUN_UPLOAD, (api) => api.uploads.$post({ query: {}, json: { files: [{ path: "index.html", size: 1, content_type: "text/html", sha256: "LXEWQrcmsEQBYnyp+6wy9chTD7GQPMTbAiWHF5IaSIE=" }] } })),
  (client) => client.call(SHOWN_UPLOAD, (api) => api.uploads[":upload"].$get({ param: PARAM, query: {} })),
  (client) => client.call(ISSUED_TICKETS, (api) => api.uploads[":upload"].tickets.$post({ param: PARAM, query: {}, json: { paths: ["index.html"] } })),
  (client) => client.call(PUBLISHED_SITE, (api) => api.uploads[":upload"].finish.$post({ param: PARAM, query: {} })),
  (client) => client.call(ABANDONED_UPLOAD, (api) => api.uploads[":upload"].$delete({ param: PARAM, query: {} })),
  (client) => client.call(EXPORTED_SETTINGS, (api) => api.export.settings.$get({ query: {} })),
  (client) => client.call(EXPORTED_SITES, (api) => api.export.sites.$get({ query: { limit: "50" } })),
  (client) => client.call(EXPORTED_SITE, (api) => api.export.sites[":site"].$get({ param: PARAM })),
  (client) => client.call(EXPORTED_FILES, (api) => api.export.sites[":site"].files.$get({ param: PARAM, query: { version: "1" } })),
  (client) => client.call(SETTINGS_ANSWER, (api) => api.config.$get({ query: {} })),
  (client) => client.call(STARTED_UPDATE, (api) => api.update.$post({ query: {} })),
  (client) => client.call(UPDATE_STATE, (api) => api.update.$get({ query: {} })),
];

const property = fuzzTarget(import.meta.file);

const calls = fc.constantFrom(...CALLS);
const statuses = fc.oneof(fc.constantFrom(...STATUSES), fc.integer({ min: 200, max: 599 }));
const jsonTexts = fc.oneof(fc.constantFrom(...NEAR_ANSWERS), fc.jsonValue()).map((value) => JSON.stringify(value));
const bodies = fc
  .oneof(
    { arbitrary: jsonTexts, weight: 5 },
    { arbitrary: fc.uint8Array({ maxLength: 256 }), weight: 1 },
    { arbitrary: hostile(fc.constantFrom(...NEAR_ANSWERS.map((answer) => JSON.stringify(answer)))), weight: 2 },
  )
  .map((body) => (typeof body === "string" ? new TextEncoder().encode(body) : body));
const answers = fc.oneof(
  { arbitrary: fc.record({ status: fc.oneof({ arbitrary: fc.constant(200), weight: 3 }, { arbitrary: statuses, weight: 2 }), body: bodies }), weight: 8 },
  { arbitrary: fc.anything().map((thrown) => ({ thrown })), weight: 1 },
);

/** The response of an address that may be no install; a status that takes no body is answered without one. */
function respond(status: number, body: Uint8Array): Response {
  const bare = status === 204 || status === 205 || status === 304;

  return new Response(bare ? null : new Uint8Array(body).buffer, { status });
}

/** A `fetch` that gives the answers in turn, and the last one for every request after them. */
function scripted(script: readonly ({ status: number; body: Uint8Array } | { thrown: unknown })[]): (input: string, init: RequestInit) => Promise<Response> {
  let at = 0;

  return async () => {
    const answer = script[Math.min(at, script.length - 1)];
    at += 1;
    if (answer === undefined || "thrown" in answer) throw answer?.thrown;

    return respond(answer.status, answer.body);
  };
}

function parsed(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return undefined;
  }
}

mkdirSync(FOLDER);
writeFileSync(join(FOLDER, "index.html"), "<title>Report</title>");
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

property(
  "whatever an address answers, every command ends in a declared exit code with nothing thrown, no crash, and no token printed",
  fc.asyncProperty(fc.constantFrom(...COMMAND_LINES), fc.array(answers, { minLength: 1, maxLength: 8 }), async (line, script) => {
    const printed: string[] = [];
    const io: Io = {
      out: (text) => printed.push(text),
      err: (text) => printed.push(text),
      status: (text) => printed.push(text),
      fetch: scripted(script),
      machine: { env: { POPLIN_SERVER: SERVER, POPLIN_TOKEN: TOKEN, POPLIN_CONFIG_DIR: join(SCRATCH, "config") }, platform: process.platform, home: SCRATCH },
      terminal: { asks: true, progress: true },
      ask: async (question) => {
        printed.push(question);

        return "report--k3f9x2ab71qz";
      },
      timeoutMs: 1000,
      computer: "laptop",
      open: () => undefined,
      pause: async () => "over",
      stopped: new AbortController().signal,
    };

    const code = await run(line, io);
    const text = printed.join("\n");

    expect(EXIT_CODES).toContain(code);
    expect(text).not.toContain(CRASHED);
    expect(text).not.toContain(TOKEN);
  }),
);

property(
  "a file sent by its ticket is taken only for a status in the 200s, or a 412 of another place, anything else is a failure and never a throw, the token leaves for no origin but the one of the install, and no word of another place is kept",
  fc.asyncProperty(answers, hostile(fc.constantFrom(TICKET.url, `${SERVER}${TICKET.url}`, "https://files.example.net/drop?leave=1", "//files.example.net/drop", "https://")), async (answer, url) => {
    const answering = scripted([answer]);
    const withToken: string[] = [];
    const watched = (input: string, init: RequestInit): Promise<Response> => {
      if (new Headers(init.headers).has("Authorization")) withToken.push(input);

      return answering(input, init);
    };
    const client = createClient({ server: SERVER, token: TOKEN, fetch: watched, timeoutMs: 1000 });
    const sent = await client.send({ ...TICKET, url }, new Uint8Array(1));

    // The token goes with a file only to the install's own origin, whatever address a ticket names.
    expect(withToken.filter((address) => new URL(address).origin !== SERVER)).toEqual([]);

    // What another place answers is never read: its refusal is known by its status alone, as an answer nobody expected, and none of its words is kept.
    const away = URL.canParse(url, SERVER) && new URL(url, SERVER).origin !== SERVER;
    if (away && !sent.ok && "status" in sent.failure) {
      const { failure } = sent;

      expect("said" in failure).toBe(false);
      expect(failure.kind).toBe("unexpected");
    }

    if (!sent.ok) return;

    // Another place's 412 is a file it holds already or would not take: the finish of the upload tells which.
    expect("thrown" in answer ? undefined : (answer.status >= 200 && answer.status < 300) || (away && answer.status === 412)).toBe(true);
  }),
);

property(
  "a call is done only for status 200 with a JSON body, which it hands back whole, and anything else is a failure and never a throw",
  fc.asyncProperty(calls, answers, async (call, answer) => {
    const client = createClient({ server: SERVER, token: TOKEN, fetch: scripted([answer]), timeoutMs: 1000 });
    const called = await call(client);

    if (!called.ok) return;

    expect("thrown" in answer ? undefined : [answer.status, parsed(answer.body)]).toEqual([200, called.value]);
  }),
);
