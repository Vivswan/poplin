import { afterEach, describe, expect, spyOn, test } from "bun:test";

import type { Io } from "../../src/commands/records";
import { type Bench, cleanUp, folderOf, jsonOf, openBench, stateOf } from "./support/harness";

/** A site of one file, so that one lane sends and no call is on its way while that file waits to be sent again. */
const ONE = { "index.html": "<h1>notes</h1>" };

/** The shortest pause before each sending of a file again, in milliseconds: one second, doubled each time. */
const SHORTEST_PAUSES = [1000, 2000, 4000];

/** A terminal that shows the progress line. */
const WATCHED = { asks: false, progress: true };

/** No terminal: a pipe, which is sent no progress line. */
const PIPED = { asks: false, progress: false };

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

/** What a publish whose file meets passing faults prints: its arguments after the folder, the terminal, and what it must come to with each pause stretched by half: every wait, every line that is no result, and how many lines the result has. */
interface Told {
  readonly faults: Fault["faults"];
  readonly line: string;
  readonly terminal: Io["terminal"];
  readonly code: number;
  readonly waits: readonly number[];
  readonly status: readonly string[];
  readonly err: readonly string[];
  readonly out: number;
}

/** The line before a pause of so many seconds, after which the one file is sent for the `next` time, as a pipe is sent it. */
function againPiped(seconds: number, next: number): string {
  return `the install did not take index.html: sending it again in ${seconds} s, ${next} of 4`;
}

/** The same line as a terminal's progress line shows it. */
function again(seconds: number, next: number): string {
  return `${againPiped(seconds, next)} (Ctrl-C stops)`;
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
 * @returns what counts the files sent so far
 */
function faulty(bench: Bench, faults: readonly (() => Response | Promise<Response>)[]): () => number {
  let sent = 0;

  bench.hook = (request) => {
    if (!isPut(request)) return undefined;

    sent += 1;

    return faults[sent - 1]?.();
  };

  return () => sent;
}

/** The uploads that are no site, as `kind state`, and their ids. */
async function unfinished(bench: Bench): Promise<{ readonly said: string[]; readonly ids: string[] }> {
  const { uploads } = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });
  const open = uploads.filter((upload) => upload.state !== "finished");

  return { said: open.map((upload) => `${upload.plan.kind} ${upload.state}`), ids: open.map((upload) => upload.id) };
}

afterEach(() => {
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
  // A pause on a timer of its own, not the command's one wait, is real time here: the shortest is a second, and the whole run is held to less.
  test.each<[string, Fault]>([
    ["meets one 502 is sent again after a pause, and the site is published", { faults: [badGateway], code: 0, puts: 2, uploads: ["create finished"] }],
    ["meets three 502s in a row is sent a fourth time, after pauses of one, two, and four seconds, each stretched to twice as long at most", { faults: [badGateway, badGateway, badGateway], code: 0, puts: 4, uploads: ["create finished"] }],
    ["meets a dropped connection and then a 502 is sent a third time", { faults: [dropped, badGateway], code: 0, puts: 3, uploads: ["create finished"] }],
    ["meets four 502s in a row is given up", { faults: [badGateway, badGateway, badGateway, badGateway], code: 5, puts: 4, uploads: ["create abandoned"] }],
    ["is refused with a 400 is not sent again", { faults: [() => refusal(400, "size_mismatch", "1")], code: 1, puts: 1, uploads: ["create abandoned"] }],
    ["is refused with a page of status 403 is not sent again", { faults: [() => new Response("<html>no</html>", { status: 403 })], code: 5, puts: 1, uploads: ["create abandoned"] }],
  ])("a file that %s", async (_name, row) => {
    const bench = await openBench();
    const sent = faulty(bench, row.faults);
    const began = performance.now();

    const ran = await bench.run(folderOf("notes", ONE));
    const took = performance.now() - began;
    const { uploads } = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });

    expect([ran.code, sent(), uploads.map((upload) => `${upload.plan.kind} ${upload.state}`)]).toEqual([row.code, row.puts, [...row.uploads]]);
    expect(ran.waits.map((wait, index) => wait >= (SHORTEST_PAUSES[index] ?? 0) && wait <= 2 * (SHORTEST_PAUSES[index] ?? 0))).toEqual(Array.from({ length: row.puts - 1 }, () => true));
    expect(took).toBeLessThan(Math.min(...SHORTEST_PAUSES));
  });

  // Drift: a command that waits seconds and prints nothing looks frozen, to a person and to the agent that runs it in a pipe; a control sequence in a pipe, or one more line on stdout, breaks whoever reads the result.
  test.each<[string, Told]>([
    [
      "sent a third time says so before each pause, and the progress writes over it",
      { faults: [badGateway, badGateway], line: "", terminal: WATCHED, code: 0, waits: [1500, 3000], status: [again(2, 2), again(3, 3), "uploading 1/1 files, 14 B of 14 B", ""], err: [], out: 3 },
    ],
    [
      "given up says so before each of its three pauses, and then what it always said",
      {
        faults: [badGateway, badGateway, badGateway, badGateway],
        line: "",
        terminal: WATCHED,
        code: 5,
        waits: [1500, 3000, 6000],
        status: [again(2, 2), again(3, 3), again(6, 4), ""],
        err: ["the answer is not the install's: status 502", "the upload was given up and no site changed; is the address the one of your poplin install? poplin whoami shows it"],
        out: 0,
      },
    ],
    ["sent again with no terminal to watch says so in one plain line on stderr", { faults: [badGateway], line: "", terminal: PIPED, code: 0, waits: [1500], status: [], err: [againPiped(2, 2)], out: 3 }],
    ["sent again under --json says so on stderr, and stdout holds the one result", { faults: [badGateway], line: " --json", terminal: PIPED, code: 0, waits: [1500], status: [], err: [againPiped(2, 2)], out: 1 }],
  ])("a file that is %s", async (_name, row) => {
    const bench = await openBench();
    faulty(bench, row.faults);
    using _half = spyOn(Math, "random").mockReturnValue(0.5);

    const ran = await bench.run(`${folderOf("notes", ONE)}${row.line}`, { terminal: row.terminal });

    expect([ran.code, ran.waits, ran.status, ran.err, ran.out.length]).toEqual([row.code, [...row.waits], [...row.status], [...row.err], row.out]);
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
    bench.paused = async () => "interrupted";
    using _half = spyOn(Math, "random").mockReturnValue(0.5);

    const stopped = await bench.run(folderOf("notes", pages));

    expect([stopped.code, stopped.err, sent, stopped.waits]).toEqual([1, [againPiped(2, 2), "the command was stopped: the upload was given up and no site changed"], puts, [1500]]);
    expect((await unfinished(bench)).said).toEqual(["create abandoned"]);
  });

  // Drift: the line of a pause is written while the command runs, past the place that takes the tokens out of what a command comes to; a file named after the token would put it into a log.
  test("a file whose name holds the token is named in the line of its pause with the token taken out", async () => {
    const bench = await openBench();
    const named = `${bench.install.tokens.admin}.txt`;
    let met = false;
    bench.hook = (request) => {
      if (met || !isPut(request) || !request.url.includes(named)) return undefined;

      met = true;

      return badGateway();
    };
    using _half = spyOn(Math, "random").mockReturnValue(0.5);

    const ran = await bench.run(folderOf("notes", { ...ONE, [named]: "x" }));

    expect([ran.code, ran.err]).toEqual([0, ["the install did not take [token].txt: sending it again in 2 s, 2 of 4"]]);
  });

  // Drift: an agent that runs a publish in a pipe sees nothing for as long as the install asks it to rest, and takes the command for hung.
  test("a rest with no terminal to watch is told in one plain line on stderr, and stdout holds the one result", async () => {
    const bench = await openBench();
    const refusals = [refusal(429, "too_many_requests", "3")];
    bench.hook = (request) => (isPut(request) ? refusals.shift() : undefined);

    const ran = await bench.run(`${folderOf("notes", SIX)} --json`);

    expect([ran.code, ran.waits, ran.status, ran.err, ran.out.length]).toEqual([0, [3000], [], ["the install asks for a pause: going on in 3 s"], 1]);
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
