import { describe, expect, test } from "bun:test";
import { planDatabase, syncDatabase } from "../../../src/zone/database/database";
import { withFake } from "../support/fake-cloudflare";
import { page, refusal, reply } from "../support/replies";

const ID = "3f6c0d5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

describe("planDatabase", () => {
  const cases: readonly { readonly name: string; readonly databases: readonly object[]; readonly steps: readonly object[] }[] = [
    { name: "an account with no database", databases: [], steps: [{ kind: "create", subject: "poplin" }] },
    {
      name: "an account whose databases only hold poplin's name inside theirs, as the list's name search returns them",
      databases: [
        { uuid: "0000", name: "poplin-old" },
        { uuid: "0001", name: "my-poplin" },
      ],
      steps: [{ kind: "create", subject: "poplin" }],
    },
    {
      name: "an account with poplin's database beside others",
      databases: [
        { uuid: "0000", name: "poplin-old" },
        { uuid: ID, name: "poplin" },
      ],
      steps: [{ kind: "leave", subject: "poplin", id: ID }],
    },
  ];

  test.each(cases)("$name: the one step names poplin's database and no other, or a second database would be made on every run", ({ databases, steps }) => {
    expect<unknown>(planDatabase(databases)).toEqual(steps);
  });
});

describe("syncDatabase", () => {
  test("two runs against one account: the first creates the database by name alone, the second finds it and sends no change, and both give the same id for the binding", async () => {
    const databases: Record<string, unknown>[] = [{ uuid: "0000", name: "poplin-old" }];

    await withFake(
      (asked) => {
        if (asked.method === "GET") return page(asked, databases);

        const made = { uuid: ID, ...(asked.body as object) };
        databases.push(made);

        return reply(made);
      },
      async (connection, asked) => {
        const first = await syncDatabase(connection, "account-a", "apply");
        const sent = asked.length;
        const second = await syncDatabase(connection, "account-a", "apply");

        expect(first).toMatchObject({ ok: true, id: ID, report: { created: ["poplin"], changedNothing: false } });
        expect(second).toMatchObject({ ok: true, id: ID, report: { left: ["poplin"], changedNothing: true } });
        expect(asked.slice(sent).every((entry) => entry.method === "GET")).toBe(true);
        expect(asked.filter((entry) => entry.method !== "GET").map((entry) => [entry.method, entry.path, entry.body])).toEqual([
          ["POST", "/accounts/account-a/d1/database", { name: "poplin" }],
        ]);
        expect(databases[0]).toEqual({ uuid: "0000", name: "poplin-old" });
      },
    );
  });

  test("a key without the D1 permission: the run fails with Cloudflare's refusal and nothing is created", async () => {
    await withFake(
      () => refusal(403, 10000, "Authentication error"),
      async (connection, asked) => {
        expect(await syncDatabase(connection, "account-a", "apply")).toMatchObject({ ok: false, failure: "refused", status: 403, report: { changedNothing: true } });
        expect(asked.map((entry) => entry.method)).toEqual(["GET"]);
      },
    );
  });

  test("a create whose reply names no database is a failure, never a binding with an empty id", async () => {
    await withFake(
      (asked) => (asked.method === "GET" ? page(asked, []) : reply({ name: "poplin" })),
      async (connection) => {
        expect(await syncDatabase(connection, "account-a", "apply")).toMatchObject({ ok: false, failure: "no-id", report: { created: ["poplin"] } });
      },
    );
  });
});
