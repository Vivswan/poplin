import { describe, expect, test } from "bun:test";
import { planDns, refusedRecords, sharesZone, syncDns } from "../../../src/zone/dns/dns";
import type { DomainLayout } from "../../../src/zone/layout";
import { reportOf } from "../../../src/zone/sync";
import { withFake } from "../support/fake-cloudflare";
import { page, reply } from "../support/replies";
import { LAYOUT } from "../support/layouts";

const WILDCARD_COMMENT = "poplin: every site";
const ADMIN_COMMENT = "poplin: the dashboard, the login, and the API";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly content: string | undefined;
  readonly proxied: boolean | undefined;
  readonly comment: string | undefined;
}

function own(id: string, name: string): Row {
  return { id, name, type: "AAAA", content: "100::", proxied: true, comment: name.startsWith("*.") ? WILDCARD_COMMENT : ADMIN_COMMENT };
}

function foreign(id: string, name: string, type: string, comment?: string): Row {
  return { id, name, type, content: "192.0.2.1", proxied: false, comment };
}

function proxied(id: string, name: string, type: string): Row {
  return { ...foreign(id, name, type), proxied: true };
}

const OTHERS: readonly Row[] = [
  foreign("f1", "www.example.com", "A"),
  foreign("f2", "mail.example.com", "CNAME", "the mail host"),
  foreign("f3", "www.example.com", "AAAA"),
  foreign("f4", "example.com", "MX"),
  foreign("f5", "_dmarc.example.com", "TXT"),
  foreign("f6", "*.dev.example.com", "A"),
  foreign("f7", "_acme-challenge.example.com", "CNAME"),
];

describe("planDns", () => {
  const fresh: readonly { readonly name: string; readonly layout: DomainLayout; readonly created: readonly string[] }[] = [
    { name: "the layout", layout: LAYOUT, created: ["*.example.com", "poplin.example.com"] },
  ];

  test.each(fresh)(
    "$name on an empty zone creates the wildcard the site hostnames resolve through and the exact records its routes attach to",
    ({ layout, created }) => {
      expect(planDns(layout, [])).toEqual(created.map((subject) => ({ kind: "create", subject })));
    },
  );

  test.each(fresh)(
    "$name on a zone with other hostnames plans the same and names none of them: poplin never touches a record it did not create",
    ({ layout, created }) => {
      expect(planDns(layout, OTHERS)).toEqual(created.map((subject) => ({ kind: "create", subject })));
    },
  );

  test.each(fresh)("$name planned again over its own records changes nothing and says so", ({ layout, created }) => {
    const records = [...OTHERS, ...created.map((name, index) => own(`p${index}`, name))];
    const steps = planDns(layout, records);

    expect(steps).toEqual(created.map((subject) => ({ kind: "leave", subject })));
    expect(reportOf(steps).changedNothing).toBe(true);
  });

  test("a name another record already answers for is skipped with the reason, and that record stays: taking it over would cut off the owner's host", () => {
    const records = [foreign("f1", "poplin.example.com", "NS"), foreign("f2", "*.example.com", "NS")];
    const reason = "a record poplin did not create holds this name";

    expect(planDns(LAYOUT, records)).toEqual([
      { kind: "skip", subject: "*.example.com", reason },
      { kind: "skip", subject: "poplin.example.com", reason },
    ]);
    expect(planDns(LAYOUT, [foreign("f4", "poplin.example.com", "TXT"), foreign("f5", "poplin.example.com", "MX")])).toEqual([
      { kind: "create", subject: "*.example.com" },
      { kind: "create", subject: "poplin.example.com" },
    ]);
  });

  test("a record of poplin's that drifted is changed back, by its id", () => {
    const unproxied = [own("p0", "*.example.com"), { ...own("p1", "poplin.example.com"), proxied: false }];
    const repointed = [{ ...own("p0", "*.example.com"), content: "2001:db8::1" }, own("p1", "poplin.example.com")];

    expect(planDns(LAYOUT, unproxied)).toEqual([
      { kind: "leave", subject: "*.example.com" },
      { kind: "change", subject: "poplin.example.com", id: "p1" },
    ]);
    expect(planDns(LAYOUT, repointed)).toEqual([
      { kind: "change", subject: "*.example.com", id: "p0" },
      { kind: "leave", subject: "poplin.example.com" },
    ]);
  });

  test("a marked record whose comment is not the one for its name is changed to it: the comment is what tells the zone's owner what the record is for", () => {
    const records = [own("p0", "*.example.com"), { ...own("p1", "poplin.example.com"), comment: "poplin: the admin" }];

    expect(planDns(LAYOUT, records)).toEqual([
      { kind: "leave", subject: "*.example.com" },
      { kind: "change", subject: "poplin.example.com", id: "p1" },
    ]);
  });

  test.each(["managed by poplin", "poplin", "Poplin: every site", " poplin: every site", undefined])(
    "a record whose comment is %j does not start with the mark, so it is the zone's own and is refused, never changed",
    (comment) => {
      const records = [{ ...own("f1", "poplin.example.com"), comment }];

      expect(refusedRecords(LAYOUT, records)?.names).toEqual(["poplin.example.com"]);
      expect(sharesZone(records)).toBe(true);
    },
  );

  test("a record poplin made under a name the layout does not use is removed, and only poplin's: a same-named record without the mark stays", () => {
    const records = [own("p0", "*.example.com"), own("p1", "poplin.example.com"), own("p2", "old.example.com"), foreign("f1", "old.example.com", "A")];

    expect(planDns(LAYOUT, records)).toEqual([
      { kind: "remove", subject: "old.example.com", id: "p2" },
      { kind: "leave", subject: "*.example.com" },
      { kind: "leave", subject: "poplin.example.com" },
    ]);
  });

  test("of two marked records under one name the correct one is kept and the other removed: changing the wrong one first would collide with the right one and be refused on every run", () => {
    const records = [own("p0", "*.example.com"), { ...own("p1", "poplin.example.com"), content: "2001:db8::1" }, own("p2", "poplin.example.com")];

    expect(planDns(LAYOUT, records)).toEqual([
      { kind: "remove", subject: "poplin.example.com", id: "p1" },
      { kind: "leave", subject: "*.example.com" },
      { kind: "leave", subject: "poplin.example.com" },
    ]);
  });
});

describe("the zone's own wildcard record", () => {
  const ZONE_WILDCARD = "the zone's own proxied wildcard record already carries the site hostnames to Cloudflare";

  const cases: readonly { readonly name: string; readonly records: readonly Row[]; readonly refusal: string | undefined; readonly steps: readonly object[] }[] =
    [
      {
        name: "none: poplin creates the wildcard",
        records: [foreign("f1", "www.example.com", "A")],
        refusal: undefined,
        steps: [
          { kind: "create", subject: "*.example.com" },
          { kind: "create", subject: "poplin.example.com" },
        ],
      },
      {
        name: "a proxied one: poplin makes none of its own and theirs stays, since the route alone picks poplin's names out",
        records: [proxied("f1", "*.example.com", "A"), proxied("f2", "*.example.com", "AAAA")],
        refusal: undefined,
        steps: [
          { kind: "leave", subject: `*.example.com: ${ZONE_WILDCARD}` },
          { kind: "create", subject: "poplin.example.com" },
        ],
      },
      {
        name: "a proxied one added beside poplin's: poplin's is removed, or it would answer for the zone's other names in turn with theirs",
        records: [own("p0", "*.example.com"), proxied("f1", "*.example.com", "A")],
        refusal: undefined,
        steps: [
          { kind: "remove", subject: "*.example.com", id: "p0" },
          { kind: "leave", subject: `*.example.com: ${ZONE_WILDCARD}` },
          { kind: "create", subject: "poplin.example.com" },
        ],
      },
      {
        name: "one that is not proxied: refused, since every site hostname would resolve to its origin",
        records: [foreign("f1", "*.example.com", "CNAME", "the old host")],
        refusal: "unproxied-wildcard",
        steps: [],
      },
    ];

  test.each(cases)("$name", ({ records, refusal, steps }) => {
    const refused = refusedRecords(LAYOUT, records);

    expect<unknown>(refused?.failure).toBe(refusal);
    if (refused === undefined) expect<unknown>(planDns(LAYOUT, records)).toEqual(steps);
    if (refused !== undefined) expect(refused).toMatchObject({ names: ["*.example.com"], message: expect.stringContaining("*.example.com") });
  });
});

describe("refusedRecords", () => {
  const cases: readonly {
    readonly name: string;
    readonly layout: DomainLayout;
    readonly records: readonly Row[];
    readonly names: readonly string[] | undefined;
  }[] = [
    { name: "a zone with other hostnames and deeper wildcards the site route does not take", layout: LAYOUT, records: OTHERS, names: undefined },
    { name: "poplin's own records", layout: LAYOUT, records: [own("p0", "*.example.com"), own("p1", "old-poplin.example.com")], names: undefined },
    {
      name: "a record that only answers mail or text under a site name",
      layout: LAYOUT,
      records: [foreign("f1", "status-poplin.example.com", "MX")],
      names: undefined,
    },
    {
      name: "the zone's own hostnames that end in the marker, at any depth",
      layout: LAYOUT,
      records: [proxied("f1", "status-poplin.example.com", "CNAME"), foreign("f2", "*.eu.status-poplin.example.com", "A"), foreign("f3", "www.example.com", "A")],
      names: ["*.eu.status-poplin.example.com", "status-poplin.example.com"],
    },
    {
      name: "the zone's own hostname that ends in the public word, which the public route would take",
      layout: LAYOUT,
      records: [proxied("f1", "home-page.example.com", "A"), foreign("f2", "homepage.example.com", "A")],
      names: ["home-page.example.com"],
    },
    {
      name: "the zone's own record under the admin hostname, which the admin route would take",
      layout: LAYOUT,
      records: [proxied("f1", "poplin.example.com", "A")],
      names: ["poplin.example.com"],
    },
  ];

  test.each(cases)("$name: only a record the site route would take from its owner is refused", ({ layout, records, names }) => {
    const refused = refusedRecords(layout, records);

    expect(refused?.names).toEqual(names as string[]);
    if (refused === undefined) return;

    expect(refused.failure).toBe("shadowed-records");
    expect(refused.names.every((name) => refused.message.includes(name))).toBe(true);
  });
});

describe("sharesZone", () => {
  const cases: readonly { readonly name: string; readonly records: readonly Row[]; readonly shared: boolean }[] = [
    { name: "an empty zone", records: [], shared: false },
    {
      name: "poplin's own records, and records that answer no request",
      records: [own("p0", "*.example.com"), foreign("f1", "example.com", "MX")],
      shared: false,
    },
    { name: "another hostname", records: [foreign("f1", "www.example.com", "A")], shared: true },
    { name: "the zone's own wildcard, which answers for every other name", records: [proxied("f1", "*.example.com", "A")], shared: true },
  ];

  test.each(cases)("$name: the Free plan rate rule counts the whole zone, so it must know whether anything else answers there", ({ records, shared }) => {
    expect(sharesZone(records)).toBe(shared);
  });
});

describe("syncDns", () => {
  test("a zone with a record the site route would take is refused before any change: no route can then be made over a name of the owner's", async () => {
    await withFake(
      (asked) => page(asked, [foreign("f1", "status-poplin.example.com", "A"), foreign("f2", "www.example.com", "A")]),
      async (connection, asked) => {
        const synced = await syncDns(connection, "zone-1", LAYOUT, "apply");

        expect(synced).toMatchObject({
          ok: false,
          failure: "shadowed-records",
          names: ["status-poplin.example.com"],
          report: { created: [], changedNothing: true },
        });
        expect(asked.map((entry) => entry.method)).toEqual(["GET", "GET"]);
      },
    );
  });

  test("two runs against one zone: the first creates poplin's records beside the others, the second sends no change and reports none", async () => {
    let records: Record<string, unknown>[] = OTHERS.map((row) => ({ ...row }));
    const before = structuredClone(records);

    await withFake(
      (asked) => {
        const id = asked.path.split("/")[4];

        if (asked.method === "GET") return page(asked, records);

        if (asked.method === "POST") records.push({ id: `p${records.length}`, ...(asked.body as object) });

        if (asked.method === "DELETE") records = records.filter((row) => row.id !== id);

        return reply({ id });
      },
      async (connection, asked) => {
        const first = await syncDns(connection, "zone-1", LAYOUT, "apply");
        const sent = asked.length;
        const second = await syncDns(connection, "zone-1", LAYOUT, "apply");

        expect(first).toMatchObject({ ok: true, report: { created: ["*.example.com", "poplin.example.com"], changedNothing: false } });
        expect(first.ok && first.sharesZone).toBe(true);
        expect(second).toMatchObject({
          ok: true,
          report: { created: [], left: ["*.example.com", "poplin.example.com"], changedNothing: true },
        });
        expect(asked.slice(sent).map((entry) => entry.method)).toEqual(["GET", "GET"]);
        expect(records.slice(0, before.length)).toEqual(before);
        expect(asked.find((entry) => entry.method === "POST")?.body).toEqual({
          name: "*.example.com",
          type: "AAAA",
          content: "100::",
          proxied: true,
          ttl: 1,
          comment: WILDCARD_COMMENT,
        });
      },
    );
  });

  test("a refusal partway stops the run and reports what was already done: the owner must see a half-made zone as one", async () => {
    await withFake(
      (asked) => {
        if (asked.method === "GET") return page(asked, []);

        if ((asked.body as { name: string }).name === "poplin.example.com")
          return Response.json(
            { success: false, errors: [{ code: 81053, message: "An A, AAAA, or CNAME record with that host already exists." }] },
            { status: 400 },
          );

        return reply({ id: "p0" });
      },
      async (connection) => {
        expect(await syncDns(connection, "zone-1", LAYOUT, "apply")).toMatchObject({
          ok: false,
          failure: "refused",
          status: 400,
          report: { created: ["*.example.com"], changedNothing: false },
        });
      },
    );
  });
});
