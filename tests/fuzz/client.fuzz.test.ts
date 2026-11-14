// The client reads whatever an address answers, which may be no install at all. No answer may make a command crash, be read as a done call it is not, or be thrown at the user.

import { afterAll, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";

import { CALL_NAMES, type CallName, createClient } from "../../packages/cli/src/client/client";
import { run } from "../../packages/cli/src/commands/run";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const SERVER = "https://poplin.example.com";
const TOKEN = `poplin_${"0".repeat(16)}_${"a".repeat(64)}`;
const CRASHED = "poplin failed in a way it has no word for";
const EXIT_CODES = [0, 1, 5];
const STATUSES = [200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 409, 413, 429, 500, 502, 503];
const SCRATCH = mkdtempSync(join(tmpdir(), "poplin-fuzz-"));
const FOLDER = join(SCRATCH, "report");
const SITE = {
  id: "k3f9x2ab71qz",
  label: "report--k3f9x2ab71qz",
  name: "report",
  public_name: null,
  title: null,
  access: "private",
  url: "https://report--k3f9x2ab71qz-page.example.com",
  addresses: { site: "https://report--k3f9x2ab71qz-page.example.com", public: null },
  search_engines: false,
  embeddable: true,
  expires: "never",
  versions: [{ number: 1, published: 0, published_by: "0000000000000000" }],
  live_version: 1,
  bytes: 1,
  files: 1,
  updated: 0,
  state: "live",
};
const UPLOAD = { id: "0123456789abcdef", state: "pending", version: 1, files: 1, bytes: 1, expires: 0 };
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
  { token: { id: "0000000000000000", scope: "admin", note: "", created: 0, expires: "never" } },
  { token: { id: "0000000000000000", scope: "owner", note: "", created: 0, expires: "never" } },
  { upload: UPLOAD },
  { upload: UPLOAD, missing: ["index.html", "gone.css"], more: false },
  { upload: { id: "0123456789abcdef", state: "pending" }, missing: "index.html", more: "no" },
  { path: "index.html", size: 1 },
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

const property = fuzzTarget(import.meta.file);

const names = fc.constantFrom<CallName>(...CALL_NAMES);
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
    const code = await run(line, {
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
    });
    const text = printed.join("\n");

    expect(EXIT_CODES).toContain(code);
    expect(text).not.toContain(CRASHED);
    expect(text).not.toContain(TOKEN);
  }),
);

property(
  "a call is done only for status 200 with a JSON body, which it hands back whole, and anything else is a failure and never a throw",
  fc.asyncProperty(names, answers, async (name, answer) => {
    const client = createClient({ server: SERVER, token: TOKEN, fetch: scripted([answer]), timeoutMs: 1000 });
    const called = await client.call(name as "getSite", { site: "report--k3f9x2ab71qz", upload: "0123456789abcdef", path: "index.html" } as never);

    if (!called.ok) return;

    expect("thrown" in answer ? undefined : [answer.status, parsed(answer.body)]).toEqual([200, called.value]);
  }),
);
