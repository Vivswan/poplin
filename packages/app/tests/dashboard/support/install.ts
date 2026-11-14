// A dashboard the tests ask requests of: the serving tests' install with its settings stored, and helpers that send what a browser would.

import type { Install } from "@poplin/core/src/actions/records";
import { importSessionKey } from "@poplin/core/src/auth/cookie";
import { parseLogins } from "@poplin/core/src/auth/logins";
import type { AuditEntry } from "@poplin/core/src/records/audit";
import { defaultSettings } from "@poplin/core/src/records/settings";
import type { Site } from "@poplin/core/src/records/site";
import { MemoryStore } from "@poplin/core/src/storage/memory";

import { createDashboard } from "../../../src/dashboard/dashboard";
import type { DomainPlug } from "../../../src/dashboard/domain/records";
import { MemoryCounters } from "../../../src/limits/memory-counters";
import { mintSessionCookie, readSession } from "../../../src/login/session";
import { NOW, openInstall } from "../../sites/support/install";
import { ADDRESSES } from "../../sites/support/layout";
import { formHeadersOf } from "./browser";

/** The origin every test request is sent to. */
export const ORIGIN = "https://poplin.example.com";

/** What counts a test dashboard's tries at a login's code, all of them as one visitor's. */
export function codeCounts(counters = new MemoryCounters()): Pick<Parameters<typeof createDashboard>[0], "counters" | "visitorOf"> {
  // The method is found anew on every request, so a test that swaps one in is heard.
  return { counters: { takeMinute: (window, now) => counters.takeMinute(window, now) }, visitorOf: async () => "one-visitor" };
}

/** The key material of the test dashboard's tokens. */
export const CSRF_SECRET = new Uint8Array(32).fill(9);

/** The login address a request without a session is sent to, up to the place to return to. */
export const LOGIN = `${ORIGIN}/login?return=`;

/** How a test post differs from the one a dashboard form sends. */
interface PostOptions {
  /** Request headers laid over the form's own; `null` takes one away. */
  readonly headers?: Readonly<Record<string, string | null>>;

  /** The token to send; the one of a fresh page when left out, none for `null`. */
  readonly csrf?: string | null;
}

/** A test dashboard and what the tests read its effects from. */
export interface Opened {
  readonly install: Install;
  readonly owner: Awaited<ReturnType<typeof openInstall>>["owner"];
  readonly cookie: string;
  readonly clock: { now: number };
  readonly counters: MemoryCounters;
  readonly publish: (name: string, access?: "private" | "unlisted" | "public") => Promise<Site>;
  readonly fetch: (request: Request) => Promise<Response>;
  readonly get: (path: string, headers?: Readonly<Record<string, string>>) => Promise<Response>;
  readonly post: (path: string, fields: Readonly<Record<string, string>>, options?: PostOptions) => Promise<Response>;
  readonly token: () => Promise<string>;
  readonly audit: () => Promise<readonly AuditEntry[]>;
}

/**
 * Open a dashboard over a fresh install with the default settings and one login.
 *
 * @param domain - the domain plug to build it with; left out, the dashboard has no Domain tab
 * @returns the dashboard's helpers: `get` and `post` carry the owner's session, and `post` sends a form as a dashboard page would, token included
 */
export async function openDashboard(domain?: DomainPlug): Promise<Opened> {
  const base = await openInstall();
  const clock = { now: NOW };
  const install: Install = {
    database: base.database,
    store: new MemoryStore(),
    now: () => clock.now,
    addressOf: ADDRESSES.addressOf,
    publicAddressOf: ADDRESSES.publicAddressOf,
    reservedNames: ADDRESSES.reservedNames,
  };
  await base.database.initSettings(defaultSettings({ installer: base.owner, hostname: "poplin.example.com" }), { by: base.owner, at: NOW });

  const signing = await base.database.ensureSigningKey(new Uint8Array(32).fill(5), NOW);
  const setCookie = await mintSessionCookie({ email: base.owner, key: await importSessionKey(signing.key), now: NOW });
  const cookie = setCookie.slice(0, setCookie.indexOf(";"));

  // As a Worker would: the key and the logins are read from the database on every request, so a new key or a removed login ends the session.
  const sessionOf: Parameters<typeof createDashboard>[0]["readSession"] = async (headers) => {
    const stored = await base.database.readSigningKey();
    const logins = parseLogins((await base.database.readSettings())?.logins ?? []);
    if (stored === undefined || !logins.ok) return { ok: false };

    return readSession(headers, { key: await importSessionKey(stored), logins: logins.value, now: clock.now });
  };

  const counters = new MemoryCounters();
  const dashboard = createDashboard({ install, readSession: sessionOf, loginPath: "/login", csrfSecret: CSRF_SECRET, domain, ...codeCounts(counters) });
  const get: Opened["get"] = (path, headers = {}) => dashboard.fetch(new Request(`${ORIGIN}${path}`, { headers: { Cookie: cookie, ...headers } }));

  const tokenOf = (page: string): string => /name="csrf" value="([^"]+)"/.exec(page)?.[1] ?? "";
  const token: Opened["token"] = async () => tokenOf(await (await get("/settings")).text());

  // The headers come from a page the dashboard really answered, so a page whose policy makes a browser's form unacceptable fails every test that posts.
  const post: Opened["post"] = async (path, fields, options = {}) => {
    const page = await get("/settings");
    const csrf = options.csrf === undefined ? tokenOf(await page.text()) : options.csrf;
    const body = new URLSearchParams(csrf === null ? fields : { ...fields, csrf });
    const headers = new Headers({ Cookie: cookie, ...formHeadersOf(page, ORIGIN) });

    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }

    return dashboard.fetch(new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: body.toString() }));
  };

  return {
    install,
    owner: base.owner,
    cookie,
    clock,
    counters,
    publish: (name, access = "unlisted") => base.publish({ name, access, files: {} }),
    fetch: (request) => dashboard.fetch(request),
    get,
    post,
    token,
    audit: () => base.database.listAudit({ limit: 100 }),
  };
}

/**
 * Follow the redirect a change answered with.
 *
 * @returns the text of the page the browser lands on
 */
export async function landing(opened: Opened, answer: Response): Promise<string> {
  const location = answer.headers.get("Location") ?? "";

  return (await opened.get(location)).text();
}
