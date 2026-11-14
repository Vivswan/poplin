import { afterEach, describe, expect, test } from "bun:test";

import { type Bench, cleanUp, folderOf, jsonOf, openBench, stateOf } from "./support/harness";

/** A site of six files: more than the four that are on their way at once. */
const SIX = { "index.html": "<h1>notes</h1>", "a.css": "a{}", "b.css": "b{}", "c.css": "c{}", "d.css": "d{}", "e.css": "e{}" };

/** A site of twenty files, which the install copies over two calls: sixteen, then the last four. */
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

function isPut(request: Request): boolean {
  return request.method === "PUT";
}

function puts(count: number): string[] {
  return Array.from({ length: count }, () => "PUT /api/uploads/:upload/file");
}

function pathEnds(end: string): (request: Request) => boolean {
  return (request) => request.method === "POST" && new URL(request.url).pathname.endsWith(end);
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

/** The uploads that are no site, as `kind state`, and their ids. */
async function unfinished(bench: Bench): Promise<{ readonly said: string[]; readonly ids: string[] }> {
  const { uploads } = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });
  const open = uploads.filter((upload) => upload.state !== "finished");

  return { said: open.map((upload) => `${upload.plan.kind} ${upload.state}`), ids: open.map((upload) => upload.id) };
}

afterEach(cleanUp);

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
});
