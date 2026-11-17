// The check of the logs: the setting that keeps them reaches the provider by itself, with the key the install keeps and no repair between.

import { expect } from "bun:test";

import type { Bench, Check } from "../records";
import { shownInTime } from "../util";

/** The setting the provider's logs follow, and its two texts. */
const [SETTING, ON, OFF] = ["provider_logs", "on", "off"] as const;

/** Whether the install's stored setting keeps the logs. */
async function storedLogs(bench: Bench): Promise<boolean> {
  const shown = await bench.cli("config", SETTING);
  expect(shown.code).toBe(0);

  return shown.value.value === true;
}

/** Look at the provider until it keeps the install's logs, or keeps none, and answer whether it came to that in time. */
function followed(bench: Bench, wanted: boolean): Promise<boolean> {
  return shownInTime(bench, async () => (await bench.logsKept()) === wanted);
}

/** The check of the logs. The setting is put back as it was whatever the check met. */
export const LOG_CHECKS: readonly Check[] = [
  {
    id: "logs-follow",
    name: "the provider keeps the install's logs as the stored setting says: after the run's changes of the settings, after the setting is switched over, and after it is put back",
    needs: ["token", "kept-key", "provider-logs"],
    run: async (bench) => {
      const before = await storedLogs(bench);
      expect(await followed(bench, before)).toBe(true);

      try {
        expect((await bench.cli("config", SETTING, before ? OFF : ON)).code).toBe(0);
        expect([await storedLogs(bench), await followed(bench, !before)]).toEqual([!before, true]);
      } finally {
        expect((await bench.cli("config", SETTING, before ? ON : OFF)).code).toBe(0);
      }

      expect([await storedLogs(bench), await followed(bench, before)]).toEqual([before, true]);
    },
  },
];
