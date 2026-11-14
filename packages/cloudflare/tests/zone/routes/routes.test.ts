import { describe, expect, test } from "bun:test";
import type { DomainLayout } from "../../../src/zone/layout";
import { planRoutes, syncRoutes } from "../../../src/zone/routes/routes";
import { reportOf } from "../../../src/zone/sync";
import { page, reply, withFake } from "../support/fake-cloudflare";
import { OTHER_SUFFIX, SUFFIXED } from "../support/layouts";

const SCRIPT = "poplin";

interface Row {
  readonly id: string;
  readonly pattern: string;
  readonly script: string | undefined;
}

describe("planRoutes", () => {
  const fresh: readonly { readonly name: string; readonly layout: DomainLayout; readonly patterns: readonly string[] }[] = [
    { name: "the default suffix", layout: SUFFIXED, patterns: ["*-page.example.com/*", "admin.example.com/*"] },
    { name: "another suffix and admin hostname", layout: OTHER_SUFFIX, patterns: ["*-s1-x.example.com/*", "admin.tools.example.com/*"] },
  ];

  test.each(fresh)(
    "$name on a zone with no routes: one route for the hostnames that end in the suffix and one for the admin hostname, both to the Worker, and no route for any other hostname",
    ({ layout, patterns }) => {
      expect<unknown>(planRoutes({ layout, script: SCRIPT }, [])).toEqual(patterns.map((subject) => ({ kind: "create", subject, script: SCRIPT })));
    },
  );

  test.each(fresh)("$name planned again over its own routes, beside the zone's, changes nothing and says so", ({ layout, patterns }) => {
    const routes: Row[] = [
      ...patterns.map((pattern, index) => ({ id: `r${index}`, pattern, script: SCRIPT })),
      { id: "x1", pattern: "www.example.com/*", script: undefined },
      { id: "x2", pattern: "api.example.com/v1/*", script: "another-worker" },
    ];
    const steps = planRoutes({ layout, script: SCRIPT }, routes);

    expect(steps).toEqual(patterns.map((subject) => ({ kind: "leave", subject })));
    expect(reportOf(steps).changedNothing).toBe(true);
  });

  test("a pattern another route holds is skipped with the reason and that route stays: poplin never takes over a route it did not create", () => {
    const routes: Row[] = [
      { id: "x1", pattern: "*-page.example.com/*", script: "another-worker" },
      { id: "x2", pattern: "admin.example.com/*", script: undefined },
    ];
    const reason = "a route poplin did not create holds this pattern";

    expect(planRoutes({ layout: SUFFIXED, script: SCRIPT }, routes)).toEqual([
      { kind: "skip", subject: "*-page.example.com/*", reason },
      { kind: "skip", subject: "admin.example.com/*", reason },
    ]);
  });

  test("a suffix change removes the routes that name poplin's Worker and the layout no longer uses, before it creates, and no other route: a pattern must be free to be made again", () => {
    const routes: Row[] = [
      { id: "r0", pattern: "*-page.example.com/*", script: SCRIPT },
      { id: "r1", pattern: "admin.tools.example.com/*", script: SCRIPT },
      { id: "r2", pattern: "*.example.com/*", script: SCRIPT },
      { id: "x1", pattern: "shop.example.com/*", script: undefined },
      { id: "x2", pattern: "api.example.com/*", script: "another-worker" },
    ];

    expect(planRoutes({ layout: OTHER_SUFFIX, script: SCRIPT }, routes)).toEqual([
      { kind: "remove", subject: "*-page.example.com/*", id: "r0" },
      { kind: "remove", subject: "*.example.com/*", id: "r2" },
      { kind: "create", subject: "*-s1-x.example.com/*", script: SCRIPT },
      { kind: "leave", subject: "admin.tools.example.com/*" },
    ]);
  });
});

describe("syncRoutes", () => {
  test("two runs against one zone: the first creates poplin's routes beside the others, the second sends no change and reports none", async () => {
    const routes: Record<string, unknown>[] = [{ id: "x1", pattern: "api.example.com/*", script: "another-worker" }];
    const patterns = ["*-page.example.com/*", "admin.example.com/*"];

    await withFake(
      (asked) => {
        if (asked.method === "GET") return page(asked, routes);

        routes.push({ id: `r${routes.length}`, ...(asked.body as object) });

        return reply({ id: "new" });
      },
      async (connection, asked) => {
        const first = await syncRoutes(connection, "zone-1", { layout: SUFFIXED, script: SCRIPT });
        const sent = asked.length;
        const second = await syncRoutes(connection, "zone-1", { layout: SUFFIXED, script: SCRIPT });

        expect(first).toMatchObject({ ok: true, report: { created: patterns, changedNothing: false } });
        expect(second).toMatchObject({ ok: true, report: { left: patterns, changedNothing: true } });
        expect(asked.slice(sent).map((entry) => entry.method)).toEqual(["GET"]);
        expect<unknown>(asked.filter((entry) => entry.method === "POST").map((entry) => entry.body)).toEqual(
          patterns.map((pattern) => ({ pattern, script: SCRIPT })),
        );
        expect<unknown>(routes[0]).toEqual({ id: "x1", pattern: "api.example.com/*", script: "another-worker" });
      },
    );
  });
});
