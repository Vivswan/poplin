import { describe, expect, test } from "bun:test";
import { removeForwarders, syncForwarders } from "../../../src/zone/forwarders/forwarders";
import { withFake } from "../support/fake-cloudflare";
import { ADDRESSES } from "../support/layouts";
import { type Asked, page, refusal, reply } from "../support/replies";

/** A Worker of the account behind the fake: what the list, the settings, and the addresses answer of it. */
interface Worker {
  readonly id?: string;
  readonly tags?: readonly string[];
  readonly bindings?: readonly { readonly name: string; readonly type: string; readonly service?: string }[];
  readonly enabled?: boolean;
  readonly previews_enabled?: boolean;
}

const SCRIPTS = "/accounts/account-a/workers/scripts";
const OWN = ["poplin-forwarder"];
const BOUND = [{ name: "POPLIN", type: "service", service: "poplin" }];
const CODE = "export default { fetch: (request, env) => env.POPLIN.fetch(request) };\n";
const METADATA = { main_module: "forwarder.js", compatibility_date: "2026-11-01", bindings: [{ type: "service", name: "POPLIN", service: "poplin" }], tags: OWN };
const ADDRESSES_ON = { enabled: true, previews_enabled: false };
const NOT_OWN = "a Worker of this name is not poplin's: rename or delete it";

/** A forwarder as the install wants it, with what a test changes. */
function forwarder(id: string, changes: Partial<Worker> = {}): Worker {
  return { id, tags: OWN, bindings: BOUND, ...ADDRESSES_ON, ...changes };
}

/** What an upload leaves behind the fake: the Worker with the tags and bindings sent, and for a new one the addresses Cloudflare starts it with. */
function uploaded(workers: Worker[], name: string, body: unknown): Response {
  const { metadata } = body as { readonly metadata: { readonly tags: string[]; readonly bindings: Worker["bindings"] } };
  const at = workers.findIndex((worker) => worker.id === name);
  const made = { enabled: false, previews_enabled: true, ...workers[at], id: name, tags: metadata.tags, bindings: metadata.bindings };

  workers.splice(at < 0 ? workers.length : at, 1, made);

  return reply({ id: name });
}

/** What a Worker the account has answers: its settings, its addresses after any switch, or its own delete. */
function answered(workers: Worker[], at: number, asked: Asked, part: string | undefined): Response {
  const current = workers[at] ?? {};
  if (asked.method === "DELETE") {
    workers.splice(at, 1);

    return new Response(null, { status: 204 });
  }

  if (part === "settings") return reply({ bindings: current.bindings ?? [], tags: current.tags });

  const switched = asked.method === "POST" ? { ...current, ...(asked.body as object) } : current;

  workers.splice(at, 1, switched);

  return reply({ enabled: switched.enabled, previews_enabled: switched.previews_enabled });
}

/** An account's Workers behind the fake: the list, each Worker's settings and addresses, an upload, the address switch, and a delete, as Cloudflare answers them. */
function account(workers: Worker[]): (asked: Asked) => Response | undefined {
  return (asked) => {
    const [, name, part] = /^\/accounts\/account-a\/workers\/scripts(?:\/([^/?]+))?(?:\/([a-z-]+))?/.exec(asked.path) ?? [];
    if (name === undefined) return asked.method === "GET" ? page(asked, workers) : undefined;

    if (asked.method === "PUT" && part === undefined) return uploaded(workers, name, asked.body);

    const at = workers.findIndex((worker) => worker.id === name);

    return at < 0 ? refusal(404, 10007, "This Worker does not exist on your account.") : answered(workers, at, asked, part);
  };
}

/** Every change a run sent, as its method, its path, and what it carried. */
function changes(asked: readonly Asked[]): [method: string, path: string, body: unknown][] {
  return asked.filter((entry) => entry.method !== "GET").map((entry) => [entry.method, entry.path, entry.body]);
}

describe("syncForwarders", () => {
  test("two runs against one account: the first uploads each forwarder with its one binding and its tag and then switches its free address on and its previews off; the second sends no change", async () => {
    const workers: Worker[] = [{ id: "poplin", tags: [] }];

    await withFake(account(workers), async (connection, asked) => {
      const first = await syncForwarders(connection, "account-a", ADDRESSES, "apply");
      const sent = asked.length;
      const second = await syncForwarders(connection, "account-a", ADDRESSES, "apply");

      expect(first).toMatchObject({ ok: true, report: { created: ["poplin-sites", "poplin-private"], changedNothing: false } });
      expect(second).toMatchObject({ ok: true, report: { left: ["poplin-sites", "poplin-private"], changedNothing: true } });
      expect(asked.slice(sent).every((entry) => entry.method === "GET")).toBe(true);
      expect(changes(asked)).toEqual([
        ["PUT", `${SCRIPTS}/poplin-sites`, { metadata: METADATA, "forwarder.js": CODE }],
        ["POST", `${SCRIPTS}/poplin-sites/subdomain`, ADDRESSES_ON],
        ["PUT", `${SCRIPTS}/poplin-private`, { metadata: METADATA, "forwarder.js": CODE }],
        ["POST", `${SCRIPTS}/poplin-private/subdomain`, ADDRESSES_ON],
      ]);
      expect(workers[0]).toEqual({ id: "poplin", tags: [] });
    });
  });

  test("a forwarder left half made is finished without a second upload, one bound elsewhere is uploaded anew, and a plan of the same account sends nothing", async () => {
    const workers = [forwarder("poplin-sites", { enabled: false, previews_enabled: true }), forwarder("poplin-private", { bindings: [] })];

    await withFake(account(workers), async (connection, asked) => {
      const planned = await syncForwarders(connection, "account-a", ADDRESSES, "plan");

      expect(planned).toMatchObject({ ok: true, report: { changed: ["poplin-sites", "poplin-private"], changedNothing: false } });
      expect(changes(asked)).toEqual([]);

      expect(await syncForwarders(connection, "account-a", ADDRESSES, "apply")).toMatchObject({ ok: true, report: { changed: ["poplin-sites", "poplin-private"] } });
      expect(changes(asked)).toEqual([
        ["POST", `${SCRIPTS}/poplin-sites/subdomain`, ADDRESSES_ON],
        ["PUT", `${SCRIPTS}/poplin-private`, { metadata: METADATA, "forwarder.js": CODE }],
        ["POST", `${SCRIPTS}/poplin-private/subdomain`, ADDRESSES_ON],
      ]);
      expect(workers).toEqual([forwarder("poplin-sites"), forwarder("poplin-private")]);
    });
  });

  test("a Worker of a forwarder's name that is not poplin's is never read further nor written: it is skipped with the reason, and the other forwarder is still made", async () => {
    const own = { id: "poplin-sites", tags: ["the owner's own"] };
    const workers: Worker[] = [own];

    await withFake(account(workers), async (connection, asked) => {
      const synced = await syncForwarders(connection, "account-a", ADDRESSES, "apply");

      expect(synced).toMatchObject({ ok: true, report: { created: ["poplin-private"], skipped: [{ subject: "poplin-sites", reason: NOT_OWN }] } });
      expect(asked.filter((entry) => entry.path.startsWith(`${SCRIPTS}/poplin-sites`))).toEqual([]);
      expect(workers[0]).toBe(own);
    });
  });

  test("a token without the Workers Scripts permission: the run fails with Cloudflare's refusal before any plan and nothing is uploaded", async () => {
    await withFake(
      () => refusal(403, 10000, "Authentication error"),
      async (connection, asked) => {
        expect(await syncForwarders(connection, "account-a", ADDRESSES, "apply")).toMatchObject({ ok: false, failure: "refused", status: 403, report: { changedNothing: true } });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      },
    );
  });

  test("an upload Cloudflare refuses stops the run at that forwarder: its address is never switched on and the forwarder after it is named as not run", async () => {
    const workers: Worker[] = [];

    await withFake(
      (asked) => (asked.method === "PUT" ? refusal(400, 10021, "the service binding names no Worker") : account(workers)(asked)),
      async (connection, asked) => {
        const synced = await syncForwarders(connection, "account-a", ADDRESSES, "apply");

        expect(synced).toMatchObject({ ok: false, failure: "refused", status: 400, failed: "poplin-sites", unrun: ["poplin-private"], report: { changedNothing: true } });
        expect(changes(asked).map(([method, path]) => [method, path])).toEqual([["PUT", `${SCRIPTS}/poplin-sites`]]);
      },
    );
  });
});

describe("removeForwarders", () => {
  test("starting over twice: the first run deletes poplin's two forwarders and no other Worker, the second finds none and sends nothing", async () => {
    const kept = [{ id: "poplin", tags: [] }, forwarder("pages-sites")];
    const workers = [...kept, forwarder("poplin-sites"), forwarder("poplin-private")];

    await withFake(account(workers), async (connection, asked) => {
      const first = await removeForwarders(connection, "account-a", ADDRESSES, "apply");
      const second = await removeForwarders(connection, "account-a", ADDRESSES, "apply");

      expect(first).toMatchObject({ ok: true, report: { removed: ["poplin-sites", "poplin-private"] } });
      expect(second).toMatchObject({ ok: true, report: { removed: [], changedNothing: true } });
      expect(changes(asked)).toEqual([
        ["DELETE", `${SCRIPTS}/poplin-sites`, undefined],
        ["DELETE", `${SCRIPTS}/poplin-private`, undefined],
      ]);
      expect(workers).toEqual(kept);
    });
  });

  test("a Worker of a forwarder's name that is not poplin's is never deleted: it is skipped with the reason, and poplin's own forwarder beside it still goes", async () => {
    const own = forwarder("poplin-private", { tags: [] });
    const workers = [own, forwarder("poplin-sites")];

    await withFake(account(workers), async (connection, asked) => {
      const removed = await removeForwarders(connection, "account-a", ADDRESSES, "apply");

      expect(removed).toMatchObject({ ok: true, report: { removed: ["poplin-sites"], skipped: [{ subject: "poplin-private", reason: NOT_OWN }] } });
      expect(changes(asked)).toEqual([["DELETE", `${SCRIPTS}/poplin-sites`, undefined]]);
      expect(workers).toEqual([own]);
    });
  });
});
