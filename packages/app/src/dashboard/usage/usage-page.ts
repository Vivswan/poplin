// The Usage tab: what the install holds and has answered today, each against its limit.

import { readConfig } from "@poplin/core/src/actions/config";
import { showBytes, sizeBytes } from "@poplin/core/src/records/settings";
import { html } from "hono/html";

import { refusedPage } from "../page/frame";
import type { Html, Page, Visit } from "../records";

/** How many characters of an ISO timestamp are its day. */
const DAY_LENGTH = 10;

/** One line of the table: what is counted, how much of it there is, and the limit it is counted against. */
interface Line {
  readonly what: string;
  readonly used: number;
  readonly limit?: number;
  readonly show: (amount: number) => string;
}

function count(amount: number): string {
  return String(amount);
}

function lineRow(line: Line): Html {
  if (line.limit === undefined) return html`<tr><th scope="row">${line.what}</th><td>${line.show(line.used)}</td><td>no limit</td><td></td></tr>`;

  const share = line.limit === 0 ? 0 : Math.round((line.used / line.limit) * 100);

  return html`<tr>
<th scope="row">${line.what}</th>
<td>${line.show(line.used)}</td>
<td>${line.show(line.limit)}</td>
<td><meter min="0" max="${line.limit}" value="${Math.min(line.used, line.limit)}">${share}%</meter> ${share}%</td>
</tr>`;
}

/**
 * Show the stored totals and the day's requests.
 *
 * @returns the bytes against `max_total_size`, the sites against `max_sites`, the sites in the trash, the files, today's writes to the storage against `max_storage_writes_per_day`, and today's requests against `requests_per_day`
 */
export async function showUsage(visit: Visit): Promise<Page> {
  const place = { tab: "usage", heading: "Usage" } as const;
  const config = await readConfig(visit.install, visit.actor);
  if (!config.ok) return refusedPage(place, config);

  const { values } = config;
  const day = new Date(visit.install.now()).toISOString().slice(0, DAY_LENGTH);
  const { database } = visit.install;
  const [totals, requests, written] = await Promise.all([database.readTotals(), database.readRequests(day), database.readStorageWrites(day)]);
  const lines: readonly Line[] = [
    { what: "Stored", used: totals.bytes, limit: sizeBytes(values.max_total_size), show: showBytes },
    { what: "Sites, the trash included", used: totals.sites, limit: values.max_sites === "none" ? undefined : values.max_sites, show: count },
    { what: "Sites in the trash", used: totals.trashed_sites, show: count },
    { what: "Files", used: totals.files, show: count },
    { what: "Writes to the storage today", used: written?.writes ?? 0, limit: values.max_storage_writes_per_day, show: count },
    { what: "Requests today", used: requests.all, limit: values.requests_per_day, show: count },
  ];

  const body = html`<div class="scroll" role="region" aria-label="Usage" tabindex="0"><table>
<thead><tr><th scope="col">What</th><th scope="col">Now</th><th scope="col">Limit</th><th scope="col">Share</th></tr></thead>
<tbody>${lines.map(lineRow)}</tbody>
</table></div>
<p class="hint">Requests are counted from a sample, so today's number is approximate. The day is the UTC day.</p>`;

  return { ...place, body };
}
