// Exact counters kept in memory, for tests and local runs. They live as long as the process, and one process shares them with no other.

import type { RequestCounts } from "@poplin/core/src/database/database";

import type { Counters, DayWindow, MinuteWindow, Taken } from "./limits";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;

/** Counts every request exactly. A minute is a minute of the clock: every count starts anew when the minute hand moves. */
export class MemoryCounters implements Counters {
  #minute = 0;

  readonly #taken = new Map<string, number>();

  #day = "";

  readonly #counted = new Map<string, number>();

  #all = 0;

  async takeMinute(window: MinuteWindow, now: number): Promise<Taken> {
    const minute = Math.floor(now / MS_PER_MINUTE);
    if (minute !== this.#minute) {
      this.#minute = minute;
      this.#taken.clear();
    }

    const key = `${window.scope}:${window.key}`;
    const taken = this.#taken.get(key) ?? 0;
    if (taken >= window.limit) return { ok: false, retryAfterSeconds: Math.ceil(((minute + 1) * MS_PER_MINUTE - now) / MS_PER_SECOND) };

    this.#taken.set(key, taken + 1);

    return { ok: true };
  }

  async readDay(window: DayWindow): Promise<RequestCounts> {
    this.#startDay(window.day);

    return { site: this.#counted.get(window.site) ?? 0, all: this.#all };
  }

  async countDay(window: DayWindow): Promise<void> {
    this.#startDay(window.day);
    this.#counted.set(window.site, (this.#counted.get(window.site) ?? 0) + 1);
    this.#all += 1;
  }

  #startDay(day: string): void {
    if (day === this.#day) return;

    this.#day = day;
    this.#counted.clear();
    this.#all = 0;
  }
}
