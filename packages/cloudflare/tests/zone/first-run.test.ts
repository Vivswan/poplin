import { expect, test } from "bun:test";
import type { DomainReading, DomainSettings } from "@poplin/app/src/console/domain/records";
import type { Login } from "@poplin/core/src/auth/logins";
import { createFirstRun } from "../../src/zone/first-run";
import { withFake } from "./support/fake-cloudflare";
import { ACCOUNT, type Account, answer, emptyAccount, KEY_VALUE_START, OTHER_TOKEN, TEAM, TOKEN } from "./support/fake-install";
import type { Asked } from "./support/replies";

const OWNER = "owner@example.com" as Login;
const STORED: DomainSettings = { logins: [OWNER], outside_pages: "blocked", search_engines_allowed: false, block_bots: "auto" };
const SETTINGS = async (): Promise<DomainSettings> => STORED;

const CALLS_A_FREE_PLAN_REQUEST_MAY_SEND = 50;

/** An account whose Worker was deployed and holds nothing of an install yet. */
function deployed(): Account {
  return { ...emptyAccount(), bindings: [{ name: "SITES", type: "r2_bucket", bucket_name: "poplin-sites" }, { name: "DB", type: "d1", id: "database-1" }, { name: "WORKER_NAME", type: "plain_text", text: "poplin" }] };
}

function shown(reading: DomainReading): string[] {
  if (!reading.ok) return [`refused: ${reading.refusal}`];

  return reading.rows.map((row) => `${row.object} | ${row.state} | ${row.detail}`);
}

/** Run a test against an account at the fake API, with the plug of a typed domain and the owner's login. */
async function withFirstRun(account: Account, domain: string, run: (plug: NonNullable<ReturnType<ReturnType<typeof createFirstRun>["plugFor"]>>, asked: readonly Asked[]) => Promise<void>): Promise<void> {
  await withFake(
    (asked) => answer(account, asked),
    async (connection, asked) => {
      const plug = createFirstRun({ script: "poplin", baseUrl: connection.baseUrl }).plugFor({ domain, login: OWNER });
      if (plug === undefined) throw new Error("the test's domain was refused");

      await run(plug, asked);
    },
  );
}

// Drift: an install with nothing set has no account to act on but the one the token shows; a Worker left with half its values would start as neither a new install nor a working one.
test("one repair gives a deployed Worker its domain, its first login, its account, its login facts, and its key in one change, keeps every other binding, and fits what one request may send", async () => {
  const account = deployed();

  await withFirstRun(account, "example.com", async (plug, asked) => {
    const checked = shown(await plug.check(TOKEN, SETTINGS)).filter((row) => row.startsWith("Worker variable"));
    const unsent = asked.filter((entry) => entry.method !== "GET").length;
    const before = asked.length;
    const repaired = await plug.repair(TOKEN, SETTINGS);
    const changes = asked.slice(before).filter((entry) => entry.method === "PATCH");

    expect([checked, unsent]).toEqual([
      ["Worker variable | missing | ACCESS: written once the Access application exists", "Worker variable | missing | ACCOUNT_ID", "Worker variable | missing | FIRST_SETTINGS", "Worker variable | missing | ZONE"],
      0,
    ]);
    expect(shown(repaired).filter((row) => row.startsWith("Worker variable"))).toEqual(["ACCESS", "ACCOUNT_ID", "FIRST_SETTINGS", "ZONE"].map((name) => `Worker variable | created | ${name}`));
    expect(repaired).toMatchObject({ steps: [{ text: "The login is ready. Open your dashboard and log in:", address: "https://poplin.example.com" }] });
    expect(changes).toHaveLength(1);
    expect(account.bindings).toEqual([
      { name: "SITES", type: "r2_bucket", bucket_name: "poplin-sites" },
      { name: "DB", type: "d1", id: "database-1" },
      { name: "WORKER_NAME", type: "plain_text", text: "poplin" },
      { name: "ZONE", type: "json", json: { domain: "example.com" } },
      { name: "FIRST_SETTINGS", type: "json", json: { logins: OWNER } },
      { name: "ACCOUNT_ID", type: "plain_text", text: ACCOUNT },
      { name: "ACCESS", type: "json", json: { team_domain: TEAM, audience: account.applications[0]?.aud } },
      { name: "KEPT_KEY", type: "secret_text" },
    ]);
    // The key goes in that one change and nowhere else, and no row or step repeats it.
    expect(asked.filter((entry) => JSON.stringify(entry.body ?? "").includes(KEY_VALUE_START)).map((entry) => entry.method)).toEqual(["PATCH"]);
    expect([shown(repaired).filter((row) => row.startsWith("Key")), JSON.stringify(repaired).includes(KEY_VALUE_START)]).toEqual([["Key | created | poplin kept key"], false]);
    // Every call but the search for the zone goes under the zone and the account the token showed the domain in, and under no other.
    expect(asked.slice(before).map((entry) => entry.path).filter((path) => !path.startsWith("/zones?") && !path.startsWith("/zones/zone-1/") && !path.startsWith(`/accounts/${ACCOUNT}/`))).toEqual([]);
    expect(asked.length - before).toBeLessThanOrEqual(CALLS_A_FREE_PLAN_REQUEST_MAY_SEND);
    expect(asked.length - before).toBe(36);
  });
});

// Drift: the page is open to anyone before the first login. The only thing that keeps a stranger's token from this install is that its writes go to the account its own zone is in.
test("a token of another account that has a zone of the same name acts on its own account alone: this account's Worker, records, and login are untouched, and no row says anything of them", async () => {
  const account = deployed();
  const before = structuredClone(account);

  await withFirstRun(account, "example.com", async (plug, asked) => {
    const reading = await plug.repair(OTHER_TOKEN, SETTINGS);
    const paths = asked.map((entry) => entry.path.split("?")[0] ?? "");

    expect(account).toEqual(before);
    expect(paths.filter((path) => path.includes(ACCOUNT) || path.includes("zone-1"))).toEqual([]);
    expect([...new Set(paths)].slice(0, 2)).toEqual(["/zones", "/zones/zone-b/dns_records"]);
    expect(JSON.stringify(reading).includes(ACCOUNT)).toBe(false);
  });
});

test("a good token that shows no zone of the typed domain is told so, and nothing else is asked: a mistyped domain must not set an install up under another", async () => {
  await withFirstRun(deployed(), "example.org", async (plug, asked) => {
    expect(await plug.repair(TOKEN, SETTINGS)).toEqual({ ok: false, refusal: "no_domain" });
    expect([...new Set(asked.map((entry) => entry.path.split("?")[0]))]).toEqual(["/zones"]);
  });
});

// Drift: Access is switched on by a person, in a browser, after the fact; an install that could not get its values until then would show the same empty page again with nothing saying why.
test("on an account whose Access is off the Worker still gets its domain, its first login, and its account, and the login facts wait for the application", async () => {
  const account = { ...deployed(), accessOff: true };

  await withFirstRun(account, "example.com", async (plug) => {
    const repaired = await plug.repair(TOKEN, SETTINGS);

    expect(account.bindings.map((binding) => binding.name)).toEqual(["SITES", "DB", "WORKER_NAME", "ZONE", "FIRST_SETTINGS", "ACCOUNT_ID", "KEPT_KEY"]);
    expect(repaired).toMatchObject({ steps: [{ text: "Open Zero Trust and pick a plan (Free works): that switches Access on." }] });
  });
});
