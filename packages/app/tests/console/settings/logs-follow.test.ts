// The setting of the install's logs carried to the provider after a change of it: which value the provider ends with, and what a refusal leaves.
// Without these a saved setting could leave the provider keeping logs the install says it keeps none of, a save of any other setting could call the provider for nothing, or an install with no key could ask it at all.

import { describe, expect, test } from "bun:test";

import type { KeyRefusal } from "../../../src/console/key/records";
import { followLogs, type LogsFollow } from "../../../src/console/settings/logs-follow";
import { openApi } from "../../api/support/install";
import { openConsole } from "../support/console";
import { usualPlug } from "../support/fake-plug";
import { openOwned } from "../support/install";

/** A test install. */
type Owned = Awaited<ReturnType<typeof openOwned>>;

/** A provider's side of the logs written by hand: it holds the last setting it took, and records every try. */
interface FakeLogs extends LogsFollow {
  /** The setting of every try, in order. */
  readonly pushed: boolean[];

  /** Whether the provider keeps the logs, `undefined` before any try it took. */
  held: boolean | undefined;
}

/**
 * Make a provider's side of the logs.
 *
 * @param answer - what a try answers, told how many came before it; a try it leaves alone is taken. It runs while the try is under way, so a test changes the setting from it as another admin would meanwhile
 */
function fakeLogs(answer: (earlier: number) => Promise<KeyRefusal | undefined> | KeyRefusal | undefined = () => undefined, holdsKey = true): FakeLogs {
  const logs: FakeLogs = {
    pushed: [],
    held: undefined,
    holdsKey: () => holdsKey,
    async push(kept) {
      logs.pushed.push(kept);
      const refusal = await answer(logs.pushed.length - 1);
      if (refusal !== undefined) return { ok: false, refusal };

      logs.held = kept;

      return { ok: true };
    },
  };

  return logs;
}

/** Store the setting of the logs a moment later, as an admin's change does. */
async function set(opened: Owned, kept: boolean): Promise<void> {
  opened.clock.now += 1;
  await opened.install.database.changeSettings({ provider_logs: kept }, { as: "person", by: opened.owner, at: opened.install.now() });
}

describe("followLogs", () => {
  // Drift: the stored setting is what the provider must end with, whichever try wrote last.
  test("carries the stored setting, and once more the one it became while the first was carried", async () => {
    const opened = await openOwned();
    await set(opened, false);
    const plain = fakeLogs();
    const raced = fakeLogs(async (earlier) => {
      if (earlier === 0) await set(opened, true);

      return undefined;
    });

    expect([await followLogs(opened.install, plain), plain.pushed, plain.held]).toEqual([{ carried: true }, [false], false]);
    expect([await followLogs(opened.install, raced), raced.pushed, raced.held]).toEqual([{ carried: true }, [false, true], true]);
  });

  // Drift: the scheduled run allows one stating of the logs two writings. A third would run past the calls it counted.
  test("stops after two tries where the setting changed during each, and says so", async () => {
    const opened = await openOwned();
    await set(opened, false);
    const logs = fakeLogs(async (earlier) => {
      await set(opened, earlier % 2 === 0);

      return undefined;
    });

    expect([await followLogs(opened.install, logs), logs.pushed]).toEqual([{ carried: false, why: "changed_again" }, [false, true]]);
  });
});

describe("a change of the setting of the logs", () => {
  // Drift: the screen saves through this route. One that never carried would leave the logs as they were until the next update, on an install that could have switched them at once.
  test("saved on the Settings screen is carried to the provider, and a save of another setting asks it nothing", async () => {
    const logs = fakeLogs();
    const opened = await openConsole("", usualPlug(), { logs });
    const other = await opened.change("/data/settings", { texts: { trash_days: "9" } });
    const afterOther = [...logs.pushed];
    const saved = await opened.change("/data/settings", { texts: { provider_logs: "off" } });

    expect([other.status, afterOther, saved.status, logs.pushed, logs.held]).toEqual([200, [], 200, [false], false]);
  });

  // Drift: the setting is stored whatever the provider says, so a refusal is no refusal of the save: the next update states the stored setting.
  test("is answered as saved where the provider refuses, or the install holds no key, with the setting stored", async () => {
    const stored: unknown[] = [];

    for (const logs of [fakeLogs(() => "key_refused"), fakeLogs(undefined, false)]) {
      const opened = await openConsole("", usualPlug(), { logs });
      const saved = await opened.change("/data/settings", { texts: { provider_logs: "off" } });
      stored.push([saved.status, (await opened.base.install.database.readSettings())?.provider_logs, logs.pushed]);
    }

    expect(stored).toEqual([
      [200, false, [false]],
      [200, false, []],
    ]);
  });

  // Drift: `poplin config provider_logs` changes the setting through the API, with no screen behind it.
  test("made through the API is carried, and a change of another setting asks the provider nothing", async () => {
    const install = await openApi();
    const other = await install.routes.config.$patch({ json: { trash_days: 9 }, query: {} });
    const afterOther = [...install.logs.pushed];
    const changed = await install.routes.config.$patch({ json: { provider_logs: false }, query: {} });

    expect([other.status, afterOther, changed.status, install.logs.pushed, (await install.database.readSettings())?.provider_logs]).toEqual([200, [], 200, [false], false]);
  });
});
