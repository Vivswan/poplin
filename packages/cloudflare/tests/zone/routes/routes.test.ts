import { describe, expect, test } from "bun:test";
import type { DomainLayout } from "../../../src/zone/layout";
import { planRoutes, syncRoutes } from "../../../src/zone/routes/routes";
import { reportOf } from "../../../src/zone/sync";
import { page, reply, withFake } from "../support/fake-cloudflare";
import { LAYOUT } from "../support/layouts";

const SCRIPT = "poplin";

interface Row {
  readonly id: string;
  readonly pattern: string;
  readonly script: string | undefined;
}

describe("planRoutes", () => {
  const fresh: readonly { readonly name: string; readonly layout: DomainLayout; readonly patterns: readonly string[] }[] = [
    { name: "the layout", layout: LAYOUT, patterns: ["*-poplin.example.com/*", "poplin.example.com/*"] },
  ];

  test.each(fresh)(
    "$name on a zone with no routes: one route for the hostnames that end in the marker and one for the admin hostname, both to the Worker, and no route for any other hostname",
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
      { id: "x1", pattern: "*-poplin.example.com/*", script: "another-worker" },
      { id: "x2", pattern: "poplin.example.com/*", script: undefined },
    ];
    const reason = "a route poplin did not create holds this pattern";

    expect(planRoutes({ layout: LAYOUT, script: SCRIPT }, routes)).toEqual([
      { kind: "skip", subject: "*-poplin.example.com/*", reason },
      { kind: "skip", subject: "poplin.example.com/*", reason },
    ]);
  });

  test("the routes that name poplin's Worker and the layout does not use are removed, before any is created, and no other route: a pattern must be free to be made again", () => {
    const routes: Row[] = [
      { id: "r0", pattern: "*-poplin.example.com/*", script: SCRIPT },
      { id: "r1", pattern: "old.example.com/*", script: SCRIPT },
      { id: "r2", pattern: "*.example.com/*", script: SCRIPT },
      { id: "x1", pattern: "shop.example.com/*", script: undefined },
      { id: "x2", pattern: "api.example.com/*", script: "another-worker" },
    ];

    expect(planRoutes({ layout: LAYOUT, script: SCRIPT }, routes)).toEqual([
      { kind: "remove", subject: "old.example.com/*", id: "r1" },
      { kind: "remove", subject: "*.example.com/*", id: "r2" },
      { kind: "leave", subject: "*-poplin.example.com/*" },
      { kind: "create", subject: "poplin.example.com/*", script: SCRIPT },
    ]);
  });
});

describe("syncRoutes", () => {
  test("two runs against one zone: the first creates poplin's routes beside the others, the second sends no change and reports none", async () => {
    const routes: Record<string, unknown>[] = [{ id: "x1", pattern: "api.example.com/*", script: "another-worker" }];
    const patterns = ["*-poplin.example.com/*", "poplin.example.com/*"];

    await withFake(
      (asked) => {
        if (asked.method === "GET") return page(asked, routes);

        routes.push({ id: `r${routes.length}`, ...(asked.body as object) });

        return reply({ id: "new" });
      },
      async (connection, asked) => {
        const first = await syncRoutes(connection, "zone-1", { layout: LAYOUT, script: SCRIPT }, "apply");
        const sent = asked.length;
        const second = await syncRoutes(connection, "zone-1", { layout: LAYOUT, script: SCRIPT }, "apply");

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
