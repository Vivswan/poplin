import { expect, test } from "bun:test";

import { runDomain } from "../../../src/dashboard/domain/domain-run";
import { openDashboard } from "../support/install";
import { fakePlug, TOKEN } from "./support/fake-plug";

test("every text of a reading has the token taken out before anything is shown or written, and an empty token changes no text", async () => {
  const opened = await openDashboard();
  const settings = await opened.install.database.readSettings();
  if (settings === undefined) throw new Error("the settings are not stored");

  const plug = fakePlug((_run, token) => ({
    ok: true,
    rows: [{ object: `a${token}b`, state: "failed", detail: `${token}${token}` }],
    steps: [{ text: `open ${token}`, address: `https://dash.example.com/${token}` }],
  }));
  const asked = { run: "repair", settings: async () => settings, by: opened.owner, from: "setup" } as const;

  expect(await runDomain(plug, opened.install, { ...asked, token: TOKEN })).toEqual({
    ok: true,
    rows: [{ object: "a[token]b", state: "failed", detail: "[token][token]" }],
    steps: [{ text: "open [token]", address: "https://dash.example.com/[token]" }],
  });
  expect((await opened.audit())[0]?.detail).toEqual({ run: "repair", from: "setup", failed: ["a[token]b: [token][token]"] });
  expect(await runDomain(plug, opened.install, { ...asked, token: "" })).toMatchObject({ rows: [{ object: "ab", detail: "" }] });
});

test("a reading that is no table is handed on as it is and writes no audit entry: a refused token did nothing worth a line", async () => {
  const opened = await openDashboard();
  const settings = await opened.install.database.readSettings();
  if (settings === undefined) throw new Error("the settings are not stored");

  const before = await opened.audit();

  for (const refusal of ["token", "unreachable"] as const) {
    const reading = await runDomain(
      fakePlug(() => ({ ok: false, refusal })),
      opened.install,
      { run: "check", token: TOKEN, settings: async () => settings, by: opened.owner, from: "dashboard" },
    );

    expect(reading).toEqual({ ok: false, refusal });
  }

  expect(await opened.audit()).toEqual(before);
});
