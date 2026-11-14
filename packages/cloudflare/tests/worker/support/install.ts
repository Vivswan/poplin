// The Worker's entry on the simulated bindings: instances with a clock the test moves, a faked team's Access, and the product's steps as requests.

import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { issueToken } from "@poplin/core/src/actions/manage-tokens";
import type { Install } from "@poplin/core/src/actions/records";
import { ROUTES } from "@poplin/core/src/api/routes";
import type { Login } from "@poplin/core/src/auth/logins";
import { openDatabase } from "@poplin/core/src/database/open";
import { D1Driver } from "../../../src/database/d1";
import { R2Store } from "../../../src/storage/r2";
import type { Bindings } from "../../../src/worker/bindings";
import { createWorker } from "../../../src/worker/worker";
import { type Certs, certs, NOW, type Signer, sign, signer } from "../../login/support/access";

/** The bindings of wrangler.jsonc, simulated. */
export const BINDINGS: Bindings = env;

/** Where the dashboard, the login, and the API answer in wrangler.jsonc's example values. */
export const ADMIN = "https://admin.example.com";

/** The one login of the example first settings. */
export const OWNER = "owner@example.com" as Login;

/** The milliseconds of one hour. */
const HOUR_MS = 3_600_000;

/** One Worker instance. */
export type Worker = ReturnType<typeof createWorker>;

/** A test's world: the clock every instance reads, the team that signs Access tokens, and the keys address the instances fetch. */
export interface World {
  readonly clock: { now: number };
  readonly team: Signer;
  readonly certs: Certs;
}

/** What a site answered through the API, as far as the tests read it. */
export interface Published {
  readonly id: string;
  readonly label: string;
  readonly state: string;
  readonly addresses: { readonly site: string; readonly public: string | null };
}

/** One file of a test site. */
export interface TestFile {
  readonly path: string;
  readonly body: Uint8Array<ArrayBuffer>;
  readonly type: string;
}

/** Every call made to the database and the bucket through counted bindings. */
export interface Tally {
  calls: number;
}

export async function world(): Promise<World> {
  const team = await signer("team-key");

  return { clock: { now: NOW }, team, certs: certs(team) };
}

export function instance(from: World): Worker {
  return createWorker({ now: () => from.clock.now, fetch: from.certs.fetch });
}

export async function ask(worker: Worker, url: string, init: RequestInit = {}, bindings: Bindings = BINDINGS): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(url, init) as Parameters<Worker["fetch"]>[0], bindings, context);
  await waitOnExecutionContext(context);

  return response;
}

/** One scheduled run at the clock's time. */
export async function sweep(worker: Worker, from: World, bindings: Bindings = BINDINGS): Promise<void> {
  const context = createExecutionContext();
  await worker.scheduled(createScheduledController({ scheduledTime: from.clock.now, cron: "*/15 * * * *" }), bindings, context);
  await waitOnExecutionContext(context);
}

/** The install as the rule book takes it, on the same bindings: for what a test sets up or reads beside the entry. */
export async function installOf(from: World): Promise<Install> {
  const opened = await openDatabase(new D1Driver(BINDINGS.DB), from.clock.now);
  if (opened.kind !== "open") throw new Error(`the test's database did not open: ${opened.message}`);

  return {
    database: opened.database,
    store: new R2Store(BINDINGS.SITES),
    now: () => from.clock.now,
    addressOf: (label) => `https://${label}-page.example.com`,
    reservedNames: new Set(["gallery"]),
  };
}

/** A whole token of the given scope, issued by the owner through the rule book. */
export async function tokenOf(from: World, scope: "admin" | "publisher"): Promise<string> {
  const issued = await issueToken(await installOf(from), { scope: "admin", holder: OWNER }, { scope, note: "a test" });
  if (!issued.ok) throw new Error(`the test's token was refused: ${issued.code}`);

  return issued.token;
}

/** One request to the API with a token: bytes go as a file, anything else as JSON. */
export function api(worker: Worker, token: string | null, method: string, path: string, body?: Uint8Array<ArrayBuffer> | object): Promise<Response> {
  const headers = new Headers(token === null ? {} : { Authorization: `Bearer ${token}` });
  if (body === undefined) return ask(worker, `${ADMIN}${path}`, { method, headers });

  const bytes = body instanceof Uint8Array;
  headers.set("Content-Type", bytes ? "application/octet-stream" : "application/json");

  return ask(worker, `${ADMIN}${path}`, { method, headers, body: bytes ? body : JSON.stringify(body) });
}

/** The JSON of a done request. */
export async function done<Body>(response: Response): Promise<Body> {
  if (response.status !== 200) throw new Error(`the API answered ${response.status}: ${await response.text()}`);

  return response.json<Body>();
}

/** Publish files through the API's three steps: begin, one put per file, finish. */
export async function publish(worker: Worker, token: string, asked: Record<string, unknown>, files: readonly TestFile[]): Promise<Published> {
  const manifest = files.map((file) => ({ path: file.path, size: file.body.byteLength, content_type: file.type }));
  const begun = await done<{ upload: { id: string } }>(await api(worker, token, "POST", ROUTES.beginPublish.path(), { ...asked, files: manifest }));

  for (const file of files) await done(await api(worker, token, "PUT", ROUTES.uploadFile.path({ upload: begun.upload.id, path: file.path }), file.body));

  return (await done<{ site: Published }>(await api(worker, token, "POST", ROUTES.finishPublish.path({ upload: begun.upload.id })))).site;
}

export function page(text: string): TestFile {
  return { path: "index.html", body: new TextEncoder().encode(text), type: "text/html" };
}

/** Ask the login path as Access sends a person on: with the team's token for the owner, live at the clock's time. */
export async function logIn(worker: Worker, from: World, address = `${ADMIN}/login`): Promise<Response> {
  const seconds = Math.floor(from.clock.now / 1000);
  const token = await sign(from.team, { email: OWNER, iat: seconds - 10, nbf: seconds - 10, exp: seconds + 3600 });

  return ask(worker, address, { headers: { "Cf-Access-Jwt-Assertion": token } });
}

/** The `Cookie` header a browser sends after a login's `Set-Cookie`. */
export function cookieOf(login: Response): string {
  const set = login.headers.get("Set-Cookie") ?? "";

  return set.slice(0, set.indexOf(";"));
}

/** The bindings with every call to the database and the bucket counted. Preparing a statement calls nothing. */
export function countedBindings(tally: Tally): Bindings {
  const counting = <Target extends object>(target: Target): Target =>
    new Proxy(target, {
      get(inner, name) {
        const member: unknown = Reflect.get(inner, name, inner);
        if (typeof member !== "function") return member;

        return (...given: unknown[]): unknown => {
          if (name !== "prepare") tally.calls += 1;

          return Reflect.apply(member, inner, given);
        };
      },
    });

  return { ...BINDINGS, DB: counting(BINDINGS.DB), SITES: counting(BINDINGS.SITES) };
}

/** Move the clock forward. */
export function wait(from: World, hours: number): void {
  from.clock.now += hours * HOUR_MS;
}
