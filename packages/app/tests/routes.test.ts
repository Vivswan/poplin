import { describe, expect, test } from "bun:test";
import type { Hostname } from "../src/cloudflare/hostname";
import type { DomainLayout } from "../src/cloudflare/layout";
import { planRoutes, syncRoutes } from "../src/cloudflare/routes";
import { reportOf } from "../src/cloudflare/sync";
import { page, reply, withFake } from "./fake-cloudflare";
import { BARE_GALLERY, hostOf, NO_GALLERY, PER_SITE, PREFIXED, WILDCARD } from "./layouts";

const SCRIPT = "poplin";
const WWW = hostOf("www.example.com");
const MAIL = hostOf("mail.example.com");
const ADMIN = hostOf("admin.example.com");

interface Row {
  readonly id: string;
  readonly pattern: string;
  readonly script: string | undefined;
}

function desired(layout: DomainLayout, excluded: readonly Hostname[] = [], retired: readonly Hostname[] = []): Parameters<typeof planRoutes>[0] {
  return { layout, script: SCRIPT, excluded, retired };
}

describe("planRoutes", () => {
  const fresh: readonly { readonly name: string; readonly layout: DomainLayout; readonly patterns: readonly string[] }[] = [
    { name: "domain", layout: PREFIXED, patterns: ["*.example.com/*"] },
    { name: "domain, gallery off", layout: NO_GALLERY, patterns: ["*.example.com/*"] },
    { name: "domain, gallery on the bare domain", layout: BARE_GALLERY, patterns: ["*.example.com/*", "example.com/*"] },
    { name: "subdomain-per-site", layout: PER_SITE, patterns: ["*.pages.example.com/*", "admin.example.com/*", "pages.example.com/*"] },
    { name: "subdomain-wildcard", layout: WILDCARD, patterns: ["*.pages.example.com/*", "admin.example.com/*", "pages.example.com/*"] },
  ];

  test.each(fresh)(
    "$name on a zone with no routes: the wildcard route, a route for each hostname it does not cover, and one route with no Worker per excluded hostname",
    ({ layout, patterns }) => {
      expect<unknown>(planRoutes(desired(layout, [WWW, MAIL, WWW]), [])).toEqual([
        ...patterns.map((subject) => ({ kind: "create", subject, script: SCRIPT })),
        { kind: "create", subject: "www.example.com/*", script: undefined },
        { kind: "create", subject: "mail.example.com/*", script: undefined },
      ]);
    },
  );

  test.each(fresh)("$name planned again over its own routes changes nothing and says so", ({ layout, patterns }) => {
    const routes: Row[] = [
      ...patterns.map((pattern, index) => ({ id: `r${index}`, pattern, script: SCRIPT })),
      { id: "x1", pattern: "www.example.com/*", script: undefined },
      { id: "x2", pattern: "api.example.com/v1/*", script: "another-worker" },
    ];
    const steps = planRoutes(desired(layout, [WWW]), routes);

    expect(steps).toEqual([...patterns, "www.example.com/*"].map((subject) => ({ kind: "leave", subject })));
    expect(reportOf(steps).changedNothing).toBe(true);
  });

  test("a pattern another route holds is skipped with the reason and that route stays: poplin never takes over a route it did not create", () => {
    const routes: Row[] = [{ id: "x1", pattern: "*.example.com/*", script: "another-worker" }];

    expect(planRoutes(desired(PREFIXED), routes)).toEqual([
      { kind: "skip", subject: "*.example.com/*", reason: "a route poplin did not create holds this pattern" },
    ]);
  });

  test("an excluded hostname already routed to another Worker is left: it is off poplin's Worker either way", () => {
    const routes: Row[] = [
      { id: "r0", pattern: "*.example.com/*", script: SCRIPT },
      { id: "x1", pattern: "www.example.com/*", script: "another-worker" },
    ];

    expect(planRoutes(desired(PREFIXED, [WWW]), routes)).toEqual([
      { kind: "leave", subject: "*.example.com/*" },
      { kind: "leave", subject: "www.example.com/*" },
    ]);
  });

  test("a layout change removes the routes that name poplin's Worker and the layout no longer uses, before it creates: a pattern must be free to be made again", () => {
    const routes: Row[] = [
      { id: "r0", pattern: "*.example.com/*", script: SCRIPT },
      { id: "r1", pattern: "www.example.com/*", script: SCRIPT },
      { id: "x1", pattern: "shop.example.com/*", script: undefined },
      { id: "x2", pattern: "api.example.com/*", script: "another-worker" },
    ];

    expect(planRoutes(desired(PER_SITE, [WWW]), routes)).toEqual([
      { kind: "remove", subject: "*.example.com/*", id: "r0" },
      { kind: "remove", subject: "www.example.com/*", id: "r1" },
      { kind: "create", subject: "*.pages.example.com/*", script: SCRIPT },
      { kind: "create", subject: "admin.example.com/*", script: SCRIPT },
      { kind: "create", subject: "pages.example.com/*", script: SCRIPT },
      { kind: "create", subject: "www.example.com/*", script: undefined },
    ]);
  });

  test("a route with no Worker is removed only for a hostname the install recorded as excluded before, and not while it is still excluded", () => {
    const routes: Row[] = [
      { id: "r0", pattern: "*.example.com/*", script: SCRIPT },
      { id: "x1", pattern: "www.example.com/*", script: undefined },
      { id: "x2", pattern: "mail.example.com/*", script: undefined },
      { id: "x3", pattern: "shop.example.com/*", script: undefined },
    ];

    expect(planRoutes(desired(PREFIXED, [WWW], [WWW, MAIL]), routes)).toEqual([
      { kind: "remove", subject: "mail.example.com/*", id: "x2" },
      { kind: "leave", subject: "*.example.com/*" },
      { kind: "leave", subject: "www.example.com/*" },
    ]);
  });

  test("a retired exclusion on a hostname the Worker now answers on is removed and the Worker's route made in the same plan", () => {
    const routes: Row[] = [{ id: "x1", pattern: "admin.example.com/*", script: undefined }];

    expect(planRoutes(desired(PER_SITE, [], [ADMIN]), routes)).toEqual([
      { kind: "remove", subject: "admin.example.com/*", id: "x1" },
      { kind: "create", subject: "*.pages.example.com/*", script: SCRIPT },
      { kind: "create", subject: "admin.example.com/*", script: SCRIPT },
      { kind: "create", subject: "pages.example.com/*", script: SCRIPT },
    ]);
  });

  test("the Worker's own hostname is never excluded, whatever the list says: an exclusion there would take the index offline", () => {
    expect(planRoutes(desired(PREFIXED, [ADMIN]), [{ id: "r0", pattern: "*.example.com/*", script: SCRIPT }])).toEqual([
      { kind: "leave", subject: "*.example.com/*" },
      { kind: "skip", subject: "admin.example.com/*", reason: "the Worker answers on this hostname" },
    ]);
  });
});

describe("syncRoutes", () => {
  test("two runs against one zone: the first creates poplin's routes beside the others, the second sends no change and reports none", async () => {
    const routes: Record<string, unknown>[] = [{ id: "x1", pattern: "api.example.com/*", script: "another-worker" }];

    await withFake(
      (asked) => {
        if (asked.method === "GET") return page(asked, routes);

        routes.push({ id: `r${routes.length}`, script: "", ...(asked.body as object) });

        return reply({ id: "new" });
      },
      async (connection, asked) => {
        const first = await syncRoutes(connection, "zone-1", desired(PREFIXED, [WWW]));
        const sent = asked.length;
        const second = await syncRoutes(connection, "zone-1", desired(PREFIXED, [WWW]));

        expect(first).toMatchObject({ ok: true, report: { created: ["*.example.com/*", "www.example.com/*"], changedNothing: false } });
        expect(second).toMatchObject({ ok: true, report: { left: ["*.example.com/*", "www.example.com/*"], changedNothing: true } });
        expect(asked.slice(sent).map((entry) => entry.method)).toEqual(["GET"]);
        expect<unknown>(asked.filter((entry) => entry.method === "POST").map((entry) => entry.body)).toEqual([
          { pattern: "*.example.com/*", script: SCRIPT },
          { pattern: "www.example.com/*" },
        ]);
        expect<unknown>(routes[0]).toEqual({ id: "x1", pattern: "api.example.com/*", script: "another-worker" });
      },
    );
  });
});
