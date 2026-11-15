import { afterEach, describe, expect, jest, test } from "bun:test";
import { setImmediate } from "node:timers/promises";

import { type Bench, cleanUp, folderOf, jsonOf, openBench, runThroughPauses, stateOf } from "./support/harness";

/** A site of one file, so that one lane sends and no call is on its way while that file waits to be sent again. */
const ONE = { "index.html": "<h1>notes</h1>" };

/** The shortest pause before each sending of a file again, in milliseconds: one second, doubled each time. */
const SHORTEST_PAUSES = [1000, 2000, 4000];

/** A site of six files: more than the four that are on their way at once. */
const SIX = { "index.html": "<h1>notes</h1>", "a.css": "a{}", "b.css": "b{}", "c.css": "c{}", "d.css": "d{}", "e.css": "e{}" };

/** A site of twenty files, which the install copies over two calls: fifteen, then the last five. */
const TWENTY = { "index.html": "<title>Report</title>", ...Object.fromEntries(Array.from({ length: 19 }, (_page, at) => [`pages/${at}.html`, `<p>${at}</p>`])) };

/** The id of an upload, as a path names it. */
const UPLOAD_ID = /\/api\/uploads\/([0-9a-z]{16})/;

/** When the stop comes: with so many matching requests held unanswered, `at once` or a moment after the last of them left. The first `answered` matching requests are the install's to answer. */
interface Moment {
  readonly matches: (request: Request) => boolean;
  readonly answered?: number;
  readonly held: number;
  readonly stops: "at once" | "a moment later";
}

/** One stop: the command, the moment, and what must have become of it. `sent` names each upload's id as `:upload`. */
interface Stop {
  readonly command: "publish" | "duplicate";
  readonly moment: Moment;
  readonly sent: (label: string) => readonly string[];
  readonly err: readonly string[];
  readonly left: readonly string[];
}

/** One start: the command, the path its starting call ends in, how many of those calls the install answers first, the refusals the next ones get, and what must have become of it. */
interface Start {
  readonly command: "publish" | "duplicate";
  readonly start: string;
  readonly answered?: number;
  readonly refusals: readonly Response[];
  readonly waits: readonly number[];
  readonly code: number;
  readonly uploads: readonly string[];
}

/** A file that meets passing faults: what answers each sending in the install's place before the install answers itself, and what must have become of the publish. */
interface Fault {
  readonly faults: readonly (() => Response | Promise<Response>)[];
  readonly code: number;
  readonly puts: number;
  readonly uploads: readonly string[];
}

function isPut(request: Request): boolean {
  return request.method === "PUT";
}

function puts(count: number): string[] {
  return Array.from({ length: count }, () => "PUT /api/uploads/:upload/file");
}

function pathEnds(end: string): (request: Request) => boolean {
  return (request) => request.method === "POST" && new URL(request.url).pathname.endsWith(end);
}

/** A JSON refusal in the install's place, with the wait it names in seconds. */
function refusal(status: number, code: string, wait: string): Response {
  return Response.json({ error: { code, message: "no" } }, { status, headers: { "Retry-After": wait } });
}

/** Hold the matching requests unanswered, and stop the command at the moment named. A request that does not match, or that comes after the stop, is the install's to answer. */
function stopAt(bench: Bench, moment: Moment): void {
  let seen = 0;

  bench.hook = (request) => {
    if (!moment.matches(request)) return undefined;

    seen += 1;
    const held = seen - (moment.answered ?? 0);
    if (held < 1 || held > moment.held) return undefined;

    if (held === moment.held && moment.stops === "at once") bench.stop();

    if (held === moment.held && moment.stops === "a moment later") setTimeout(bench.stop, 5);

    return new Promise<Response>(() => undefined);
  };
}

/** The page of a proxy whose origin gave no answer. */
function badGateway(): Response {
  return new Response("<html>bad gateway</html>", { status: 502 });
}

/** A connection that drops before any answer. */
function dropped(): Promise<Response> {
  return Promise.reject(new TypeError("the socket closed"));
}

/**
 * Answer each sending of a file with the next fault, and let the install answer once they ran out.
 *
 * @returns when each file was sent, by the clock of the timers
 */
function faulty(bench: Bench, faults: readonly (() => Response | Promise<Response>)[]): number[] {
  const sentAt: number[] = [];

  bench.hook = (request) => {
    if (!isPut(request)) return undefined;

    sentAt.push(Date.now());

    return faults[sentAt.length - 1]?.();
  };

  return sentAt;
}

/** The uploads that are no site, as `kind state`, and their ids. */
async function unfinished(bench: Bench): Promise<{ readonly said: string[]; readonly ids: string[] }> {
  const { uploads } = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });
  const open = uploads.filter((upload) => upload.state !== "finished");

  return { said: open.map((upload) => `${upload.plan.kind} ${upload.state}`), ids: open.map((upload) => upload.id) };
}

afterEach(() => {
  jest.useRealTimers();
  cleanUp();
});

describe("upload", () => {
  // Drift: Ctrl-C outside a wait ended the process at once, and the upload it left held a place under max_sites, max_total_size, and the pending uploads for a day.
  test.each<[string, Stop]>([
    [
      "a publish while it begins, before the install named an upload: there is nothing to give up",
      {
        command: "publish",
        moment: { matches: pathEnds("/api/uploads"), held: 1, stops: "a moment later" },
        sent: () => ["POST /api/uploads"],
        err: ["the command was stopped: no site changed; an upload the install began all the same runs out by itself within a day"],
        left: [],
      },
    ],
    [
      "a publish as its first file leaves: no other file is sent",
      {
        command: "publish",
        moment: { matches: isPut, held: 1, stops: "at once" },
        sent: () => ["POST /api/uploads", ...puts(1), "DELETE /api/uploads/:upload"],
        err: ["the command was stopped: the upload was given up and no site changed"],
        left: ["create abandoned"],
      },
    ],
    [
      "a publish with four files on their way: the two that wait are never sent",
      {
        command: "publish",
        moment: { matches: isPut, held: 4, stops: "a moment later" },
        sent: () => ["POST /api/uploads", ...puts(4), "DELETE /api/uploads/:upload"],
        err: ["the command was stopped: the upload was given up and no site changed"],
        left: ["create abandoned"],
      },
    ],
    [
      "a publish while it finishes",
      {
        command: "publish",
        moment: { matches: pathEnds("/finish"), held: 1, stops: "a moment later" },
        sent: () => ["POST /api/uploads", ...puts(6), "POST /api/uploads/:upload/finish", "DELETE /api/uploads/:upload"],
        err: ["the command was stopped: the upload was given up and no site changed"],
        left: ["create abandoned"],
      },
    ],
    [
      "a duplicate during its first call, before the install named a copy: there is nothing to give up",
      {
        command: "duplicate",
        moment: { matches: pathEnds("/duplicate"), held: 1, stops: "a moment later" },
        sent: (label) => [`POST /api/sites/${label}/duplicate`],
        err: ["the command was stopped", "the answer was lost, so the change may have been made all the same; poplin list shows the sites as they are"],
        left: [],
      },
    ],
    [
      "a duplicate during its second call",
      {
        command: "duplicate",
        moment: { matches: pathEnds("/duplicate"), answered: 1, held: 1, stops: "a moment later" },
        sent: (label) => [`POST /api/sites/${label}/duplicate`, `POST /api/sites/${label}/duplicate`, "DELETE /api/uploads/:upload"],
        err: ["the command was stopped: the copy was given up and no site was made"],
        left: ["duplicate abandoned"],
      },
    ],
  ])("a stop of %s", async (_name, stop) => {
    const bench = await openBench();
    const label = stop.command === "duplicate" ? (jsonOf(await bench.run(`${folderOf("report", TWENTY)} --json`)).site as { label: string }).label : "";
    const before = await stateOf(bench);
    bench.sent.length = 0;
    stopAt(bench, stop.moment);

    const stopped = await bench.run(stop.command === "duplicate" ? `duplicate ${label}` : folderOf("notes", SIX));
    const ids = new Set(bench.sent.flatMap((line) => UPLOAD_ID.exec(line)?.[1] ?? []));
    const open = await unfinished(bench);

    expect([stopped.code, stopped.out, stopped.err]).toEqual([1, [], [...stop.err]]);
    expect(bench.sent.map((line) => line.replace(UPLOAD_ID, "/api/uploads/:upload").replace(/\?.*$/, ""))).toEqual([...stop.sent(label)]);
    expect([open.said, [...ids]]).toEqual([[...stop.left], open.ids]);
    expect(await stateOf(bench)).toEqual(before);
  });

  // Drift: a stopped command waits a few seconds for its last call and no longer; one that could not give the upload up must say that it runs out by itself, not that it was given up.
  test("a stop of a publish whose upload cannot be given up says that it runs out by itself within a day", async () => {
    const bench = await openBench();
    stopAt(bench, { matches: isPut, held: 4, stops: "a moment later" });
    const hold = bench.hook;
    bench.hook = (request) => (request.method === "DELETE" ? new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } }) : hold?.(request));

    const stopped = await bench.run(folderOf("notes", SIX));

    expect([stopped.code, stopped.err]).toEqual([1, ["the command was stopped: the upload could not be given up: it runs out by itself within a day, and poplin list shows whether a site changed"]]);
    expect(bench.sent.filter((line) => line.startsWith("DELETE"))).toHaveLength(1);
  });

  // Drift: a failed publish gives its upload up with a call the stop ends like any other; a stop during that call would leave the upload to hold its place for a day.
  test("a stop while a failed publish gives its upload up gives it up once more, with a call the stop does not end", async () => {
    const bench = await openBench();
    const before = await stateOf(bench);
    stopAt(bench, { matches: (request) => request.method === "DELETE", held: 1, stops: "a moment later" });
    const hold = bench.hook;
    bench.hook = (request) => (isPut(request) ? new Response(JSON.stringify({ error: { code: "size_mismatch", message: "no" } }), { status: 400, headers: { "Content-Type": "application/json" } }) : hold?.(request));

    const stopped = await bench.run(folderOf("notes", SIX));

    expect([stopped.code, stopped.err]).toEqual([1, ["a file changed while it was sent", "the upload was given up and no site changed; publish again once the folder is still"]]);
    expect([(await unfinished(bench)).said, bench.sent.filter((line) => line.startsWith("DELETE")).length]).toEqual([["create abandoned"], 2]);
    expect(await stateOf(bench)).toEqual(before);
  });

  // A start answered 429 began nothing, since the zone and the install's own counts answer before any action runs: made again, it leaves one upload, never two.
  // Drift: a start not made again gives a publish up at its first call on a zone that counts requests, and one made again after `allowance_spent` is refused the same until midnight UTC.
  test.each<[string, Start]>([
    [
      "a publish, by a zone's page twice",
      { command: "publish", start: "/uploads", refusals: [new Response("<html>slow down</html>", { status: 429 }), new Response("<html>slow down</html>", { status: 429 })], waits: [2000, 4000], code: 0, uploads: ["create finished"] },
    ],
    [
      "a duplicate, with a wait named",
      { command: "duplicate", start: "/duplicate", refusals: [refusal(429, "too_many_requests", "7")], waits: [7000], code: 0, uploads: ["create finished", "duplicate finished"] },
    ],
    [
      "the second call of a duplicate",
      { command: "duplicate", start: "/duplicate", answered: 1, refusals: [refusal(429, "too_many_requests", "3")], waits: [3000], code: 0, uploads: ["create finished", "duplicate finished"] },
    ],
    [
      "a publish, by a database spent for the day",
      { command: "publish", start: "/uploads", refusals: [refusal(503, "allowance_spent", "3600")], waits: [], code: 1, uploads: [] },
    ],
  ])("the start of %s is waited out and made again only when its answer is 429", async (_name, row) => {
    const bench = await openBench();
    const label = row.command === "duplicate" ? (jsonOf(await bench.run(`${folderOf("report", TWENTY)} --json`)).site as { label: string }).label : "";
    const refusals = [...row.refusals];
    const starts = pathEnds(row.start);
    let seen = 0;
    bench.sent.length = 0;

    bench.hook = (request) => {
      if (!starts(request)) return undefined;

      seen += 1;

      return seen > (row.answered ?? 0) ? refusals.shift() : undefined;
    };

    const ran = await bench.run(row.command === "duplicate" ? `duplicate ${label}` : folderOf("notes", SIX));
    const { uploads } = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });

    expect([ran.code, ran.waits, refusals.length]).toEqual([row.code, [...row.waits], 0]);
    expect(uploads.map((upload) => `${upload.plan.kind} ${upload.state}`).sort()).toEqual([...row.uploads]);
  });

  // Drift: a file sent again at once meets the same fault, so a gateway that fails for a second fails the whole publish; one sent again after a refusal that stands, or without end, holds the person up for nothing.
  test.each<[string, Fault]>([
    ["meets one 502 is sent again after a pause, and the site is published", { faults: [badGateway], code: 0, puts: 2, uploads: ["create finished"] }],
    ["meets three 502s in a row is sent a fourth time, after pauses of at least one, two, and four seconds", { faults: [badGateway, badGateway, badGateway], code: 0, puts: 4, uploads: ["create finished"] }],
    ["meets a dropped connection and then a 502 is sent a third time", { faults: [dropped, badGateway], code: 0, puts: 3, uploads: ["create finished"] }],
    ["meets four 502s in a row is given up", { faults: [badGateway, badGateway, badGateway, badGateway], code: 5, puts: 4, uploads: ["create abandoned"] }],
    ["is refused with a 400 is not sent again", { faults: [() => refusal(400, "size_mismatch", "1")], code: 1, puts: 1, uploads: ["create abandoned"] }],
    ["is refused with a page of status 403 is not sent again", { faults: [() => new Response("<html>no</html>", { status: 403 })], code: 5, puts: 1, uploads: ["create abandoned"] }],
  ])("a file that %s", async (_name, row) => {
    const bench = await openBench();
    const sentAt = faulty(bench, row.faults);

    const ran = await runThroughPauses(bench, folderOf("notes", ONE), () => sentAt.length > 0 && sentAt.length < row.puts);
    const { uploads } = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });
    const pauses = sentAt.slice(1).map((at, index) => at - (sentAt[index] ?? 0));

    expect([ran.code, sentAt.length, uploads.map((upload) => `${upload.plan.kind} ${upload.state}`)]).toEqual([row.code, row.puts, [...row.uploads]]);
    expect(pauses.map((pause, index) => pause >= (SHORTEST_PAUSES[index] ?? 0))).toEqual(pauses.map(() => true));
  });

  // Drift: a pause that does not hear the stop keeps the person waiting out seconds after Ctrl-C, and then sends the file again; a stop told as another file's refusal says the folder changed when the person stopped the command.
  test.each([
    ["alone", ONE, 1],
    ["beside a file the install refused", { ...ONE, "a.css": "a{}" }, 2],
  ])("a stop while a file waits to be sent again, %s, ends the wait at once, and the file is not sent again", async (_name, pages, puts) => {
    const bench = await openBench();
    let sent = 0;
    bench.hook = (request) => {
      if (!isPut(request)) return undefined;

      sent += 1;

      return request.url.includes("a.css") ? refusal(400, "size_mismatch", "1") : badGateway();
    };
    jest.useFakeTimers();

    const running = bench.run(folderOf("notes", pages));
    while (sent < puts) await setImmediate();
    for (let turn = 0; turn < 10; turn += 1) await setImmediate();
    bench.stop();
    const stopped = await running;

    expect([stopped.code, stopped.err, sent]).toEqual([1, ["the command was stopped: the upload was given up and no site changed"], puts]);
    expect((await unfinished(bench)).said).toEqual(["create abandoned"]);
  });

  // Drift: the line of a rest is written over by the upload's progress; a start that is refused after its rest has no progress, and its refusal would be printed onto the end of that line.
  test("a start refused after a rest leaves no line of the rest on the terminal", async () => {
    const bench = await openBench();
    const refusals = [refusal(429, "too_many_requests", "1"), refusal(400, "bad_name", "1")];
    bench.hook = (request) => (pathEnds("/uploads")(request) ? refusals.shift() : undefined);

    const ran = await bench.run(folderOf("notes", SIX), { terminal: { asks: false, progress: true } });

    expect([ran.code === 0, ran.waits, ran.status]).toEqual([false, [1000], ["the install asks for a pause: going on in 1 s (Ctrl-C stops)", ""]]);
  });

  // Drift: a copy's progress line that is never cleared has "copied ..." printed onto its end, and a pipe is sent a line no one watches.
  test("a duplicate clears its progress line before it says the copy is done, and writes none where no progress is shown", async () => {
    const bench = await openBench();
    const { label } = jsonOf(await bench.run(`${folderOf("report", TWENTY)} --json`)).site as { label: string };

    const watched = await bench.run(`duplicate ${label}`, { terminal: { asks: false, progress: true } });
    const piped = await bench.run(`duplicate ${label}`);

    expect([watched.code, watched.status, piped.code, piped.status]).toEqual([0, ["copying 15 of 20 files", ""], 0, []]);
  });
});
