import { describe, expect, test } from "bun:test";
import { foreignWildcards, otherHostnames, planDns, syncDns } from "../src/cloudflare/dns";
import type { DomainLayout } from "../src/cloudflare/layout";
import { reportOf } from "../src/cloudflare/sync";
import { page, reply, withFake } from "./fake-cloudflare";
import { BARE_GALLERY, NO_GALLERY, NO_PREFIX, PER_SITE, PREFIXED, WILDCARD } from "./layouts";

const MARK = "managed by poplin";

interface Row {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly content: string | undefined;
  readonly proxied: boolean | undefined;
  readonly comment: string | undefined;
}

function own(id: string, name: string): Row {
  return { id, name, type: "AAAA", content: "100::", proxied: true, comment: MARK };
}

function foreign(id: string, name: string, type: string, comment?: string): Row {
  return { id, name, type, content: "192.0.2.1", proxied: false, comment };
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
    { name: "domain", layout: PREFIXED, created: ["*.example.com", "admin.example.com", "pages.example.com"] },
    { name: "domain, gallery off", layout: NO_GALLERY, created: ["*.example.com", "admin.example.com"] },
    { name: "domain, gallery on the bare domain", layout: BARE_GALLERY, created: ["*.example.com", "admin.example.com", "example.com"] },
    { name: "domain, no prefix", layout: NO_PREFIX, created: ["*.example.com", "admin.example.com", "pages.example.com"] },
    { name: "subdomain-per-site", layout: PER_SITE, created: ["*.pages.example.com", "admin.example.com", "pages.example.com"] },
    { name: "subdomain-wildcard", layout: WILDCARD, created: ["*.pages.example.com", "admin.example.com", "pages.example.com"] },
  ];

  test.each(fresh)("$name on an empty zone creates the wildcard and the exact records its routes attach to", ({ layout, created }) => {
    expect(planDns(layout, [])).toEqual(created.map((subject) => ({ kind: "create", subject })));
  });

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
    const records = [foreign("f1", "admin.example.com", "CNAME"), foreign("f2", "*.example.com", "A"), foreign("f3", "pages.example.com", "NS")];
    const reason = "a record poplin did not create holds this name";

    expect(planDns(PREFIXED, records)).toEqual([
      { kind: "skip", subject: "*.example.com", reason },
      { kind: "skip", subject: "admin.example.com", reason },
      { kind: "skip", subject: "pages.example.com", reason },
    ]);
    expect(planDns(NO_GALLERY, [foreign("f4", "admin.example.com", "TXT"), foreign("f5", "admin.example.com", "MX")])).toEqual([
      { kind: "create", subject: "*.example.com" },
      { kind: "create", subject: "admin.example.com" },
    ]);
  });

  test("a record of poplin's that drifted is changed back, by its id", () => {
    const records = [
      own("p0", "*.example.com"),
      { ...own("p1", "admin.example.com"), proxied: false },
      { ...own("p2", "pages.example.com"), content: "2001:db8::1" },
    ];

    expect(planDns(PREFIXED, records)).toEqual([
      { kind: "leave", subject: "*.example.com" },
      { kind: "change", subject: "admin.example.com", id: "p1" },
      { kind: "change", subject: "pages.example.com", id: "p2" },
    ]);
  });

  test("a layout change removes the records only the old layout used, and only poplin's: a same-named record without the mark stays", () => {
    const records = [
      own("p0", "*.example.com"),
      own("p1", "admin.example.com"),
      own("p2", "pages.example.com"),
      own("p3", "old.example.com"),
      foreign("f1", "old.example.com", "A"),
    ];

    expect(planDns(PER_SITE, records)).toEqual([
      { kind: "remove", subject: "*.example.com", id: "p0" },
      { kind: "remove", subject: "old.example.com", id: "p3" },
      { kind: "create", subject: "*.pages.example.com" },
      { kind: "leave", subject: "admin.example.com" },
      { kind: "leave", subject: "pages.example.com" },
    ]);
  });

  test("of two marked records under one name the correct one is kept and the other removed: changing the wrong one first would collide with the right one and be refused on every run", () => {
    const records = [own("p0", "*.example.com"), { ...own("p1", "admin.example.com"), content: "2001:db8::1" }, own("p2", "admin.example.com")];

    expect(planDns(NO_GALLERY, records)).toEqual([
      { kind: "remove", subject: "admin.example.com", id: "p1" },
      { kind: "leave", subject: "*.example.com" },
      { kind: "leave", subject: "admin.example.com" },
    ]);
  });
});

describe("otherHostnames", () => {
  test("the zone's other exact hostnames come back once each, sorted: they feed the host rule's list and the route exclusions", () => {
    const records = [...OTHERS, own("p0", "*.example.com"), own("p1", "admin.example.com"), own("p2", "stale.example.com")];

    expect<unknown>(otherHostnames(PREFIXED, records)).toEqual(["mail.example.com", "www.example.com"]);
  });

  test("a name the layout uses is never listed, even while another record holds it: listing it would exclude poplin's own hostname from its Worker", () => {
    const records = [foreign("f1", "admin.example.com", "A"), foreign("f2", "example.com", "A")];

    expect(otherHostnames(BARE_GALLERY, records)).toEqual([]);
    expect<unknown>(otherHostnames(PREFIXED, records)).toEqual(["example.com"]);
  });
});

describe("foreignWildcards", () => {
  test("every wildcard record of the owner's is named, the one under the layout's own wildcard name too, and poplin's are not: every name one answers for is on no list", () => {
    const records = [
      ...OTHERS,
      foreign("f8", "*.dev.example.com", "CNAME"),
      foreign("f9", "*.example.com", "A"),
      foreign("f10", "*.mail.example.com", "MX"),
      own("p0", "*.old.example.com"),
    ];

    expect(foreignWildcards(records)).toEqual(["*.dev.example.com", "*.example.com"]);
    expect(foreignWildcards([own("p0", "*.example.com"), foreign("f1", "www.example.com", "A")])).toEqual([]);
  });
});

describe("syncDns", () => {
  test("a zone with a wildcard record of its own is refused before any change, with no list of other hostnames: no route or rule can then be made over the names it answers for", async () => {
    await withFake(
      (asked) => page(asked, [foreign("f1", "*.dev.example.com", "A"), foreign("f2", "www.example.com", "A")]),
      async (connection, asked) => {
        const synced = await syncDns(connection, "zone-1", PREFIXED);

        expect(synced).toMatchObject({
          ok: false,
          failure: "foreign-wildcards",
          wildcards: ["*.dev.example.com"],
          report: { created: [], changedNothing: true },
        });
        expect("otherHostnames" in synced).toBe(false);
        expect(asked.map((entry) => entry.method)).toEqual(["GET", "GET"]);
      },
    );
  });

  test("two runs against one zone: the first creates poplin's records beside the others, the second sends no change and reports none", async () => {
    let records: Record<string, unknown>[] = OTHERS.filter((row) => !row.name.includes("*")).map((row) => ({ ...row }));
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
        const first = await syncDns(connection, "zone-1", PREFIXED);
        const sent = asked.length;
        const second = await syncDns(connection, "zone-1", PREFIXED);

        expect(first).toMatchObject({ ok: true, report: { created: ["*.example.com", "admin.example.com", "pages.example.com"], changedNothing: false } });
        expect<unknown>(first.ok && first.otherHostnames).toEqual(["mail.example.com", "www.example.com"]);
        expect(second).toMatchObject({
          ok: true,
          report: { created: [], left: ["*.example.com", "admin.example.com", "pages.example.com"], changedNothing: true },
        });
        expect(asked.slice(sent).map((entry) => entry.method)).toEqual(["GET", "GET"]);
        expect(records.slice(0, before.length)).toEqual(before);
        expect(asked.find((entry) => entry.method === "POST")?.body).toEqual({
          name: "*.example.com",
          type: "AAAA",
          content: "100::",
          proxied: true,
          ttl: 1,
          comment: MARK,
        });
      },
    );
  });

  test("a refusal partway stops the run and reports what was already done: the owner must see a half-made zone as one", async () => {
    await withFake(
      (asked) => {
        if (asked.method === "GET") return page(asked, []);

        if ((asked.body as { name: string }).name === "admin.example.com")
          return Response.json(
            { success: false, errors: [{ code: 81053, message: "An A, AAAA, or CNAME record with that host already exists." }] },
            { status: 400 },
          );

        return reply({ id: "p0" });
      },
      async (connection) => {
        expect(await syncDns(connection, "zone-1", PREFIXED)).toMatchObject({
          ok: false,
          failure: "refused",
          status: 400,
          report: { created: ["*.example.com"], changedNothing: false },
        });
      },
    );
  });
});
