// An install the console's tests work on: the serving tests' install with its settings stored and its one owner logged in.

import type { Install } from "@poplin/core/src/actions/records";
import { importSessionKey } from "@poplin/core/src/auth/cookie";
import type { AuditEntry } from "@poplin/core/src/records/audit";
import { defaultSettings } from "@poplin/core/src/records/settings";
import type { Site } from "@poplin/core/src/records/site";
import { MemoryStore } from "@poplin/core/src/storage/memory";

import type { CodeTries } from "../../../src/limits/code-tries";
import { MemoryCounters } from "../../../src/limits/memory-counters";
import { mintSessionCookie } from "../../../src/login/session";
import { NOW, openInstall } from "../../sites/support/install";
import { ADDRESSES } from "../../sites/support/layout";

/** The origin every test request is sent to. */
export const ORIGIN = "https://poplin.example.com";

/** A small free plan of the tests' own: each sentence names its part, so a warning shown beside the wrong field is seen. */
export const FREE_LIMITS = {
  totalBytes: { most: 10_000_000_000, warning: "all sites are above the free 10 GB" },
  siteBytes: { most: 10_000_000_000, warning: "one site is above the free 10 GB" },
  filesPerPublish: { most: 5000, warning: "one publish is above the free 5,000 files" },
  filesPerDay: { most: 32_000, warning: "above the free 32,000 files a day" },
  storageWritesPerDay: { most: 30_000, warning: "above the free 30,000 writes a day" },
  storageReadsPerMonth: { most: 10_000_000, warning: "above the free 10,000,000 reads a month" },
  requestsPerDay: { most: 100_000, warning: "above the free 100,000 requests a day" },
  logins: { most: 50, warning: "above the free 50 users" },
} as const;

/** A host of the tests' own that reads no figures: each limit and each page differs, so a number or a link on the wrong line is seen. */
export const USAGE_HOST = {
  name: "Provider",
  limits: { requestsPerDay: 100_000, rowsReadPerDay: 5_000_000, rowsWrittenPerDay: 90_000, storedBytes: 10_000_000_000, storageWritesPerMonth: 1_000_000, storageReadsPerMonth: 10_000_000 },
  links: { requests: "https://provider.example/requests", database: "https://provider.example/database", storage: "https://provider.example/storage" },
} as const;

/** The version of poplin the test console says it runs. */
export const VERSION = "1.0.0";

/** A test install and what the tests read its effects from. */
interface Owned {
  readonly install: Install;
  readonly owner: Awaited<ReturnType<typeof openInstall>>["owner"];
  readonly cookie: string;
  readonly clock: { now: number };
  readonly counters: MemoryCounters;
  readonly publish: (name: string, access?: "private" | "unlisted" | "public", by?: Site["owner"]) => Promise<Site>;
  readonly audit: () => Promise<readonly AuditEntry[]>;
}

/** What counts a test console's tries at a login's code, all of them as one visitor's. */
export function codeCounts(counters = new MemoryCounters()): CodeTries {
  // The method is found anew on every request, so a test that swaps one in is heard.
  return { counters: { takeMinute: (window, now) => counters.takeMinute(window, now) }, visitorOf: async () => "one-visitor" };
}

/**
 * Open a fresh install with the default settings and one login, who holds a session.
 *
 * @returns the install and its helpers: `publish` makes a site, published by the owner unless it names who, and `cookie` is the owner's session
 */
export async function openOwned(): Promise<Owned> {
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
  await base.database.initSettings(defaultSettings({ installer: base.owner }), { by: base.owner, at: NOW });

  const signing = await base.database.ensureSigningKey(new Uint8Array(32).fill(5), NOW);
  const setCookie = await mintSessionCookie({ email: base.owner, key: await importSessionKey(signing.key), now: NOW });

  return {
    install,
    owner: base.owner,
    cookie: setCookie.slice(0, setCookie.indexOf(";")),
    clock,
    counters: new MemoryCounters(),
    publish: (name, access = "unlisted", by = base.owner) => base.publish({ name, access, files: {}, by }),
    audit: () => base.database.listAudit({ limit: 100 }),
  };
}
