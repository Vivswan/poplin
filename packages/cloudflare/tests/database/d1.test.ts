import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";

import { beginPublish } from "@poplin/core/src/actions/begin-publish";
import { beginLogin, redeemLogin } from "@poplin/core/src/actions/computer-logins";
import { finishPublish } from "@poplin/core/src/actions/finish-publish";
import type { Install } from "@poplin/core/src/actions/records";
import { uploadFile } from "@poplin/core/src/actions/upload-file";
import type { Login } from "@poplin/core/src/auth/logins";
import type { Actor } from "@poplin/core/src/auth/scopes";
import type { TokenId } from "@poplin/core/src/auth/tokens";
import { openDatabase } from "@poplin/core/src/database/open";
import { defaultSettings } from "@poplin/core/src/records/settings";
import { MemoryStore } from "@poplin/core/src/storage/memory";
import { begunFiles, describeDatabase, numberedFiles } from "@poplin/core/tests/database/support/database-contract";
import { describeSqlDriver, sqlDatabaseOver } from "@poplin/core/tests/database/support/sql-driver-contract";

import type { Bindings } from "../../src/worker/bindings";
import { D1Driver } from "../../src/database/d1";

/** The bindings of wrangler.jsonc, simulated. */
const BINDINGS: Bindings = env;

/** The moment every fixture is made at. */
const NOW = 1_700_000_000_000;

/** A publisher's token, which begins the fixture publishes. */
const PUBLISHER: Actor = { scope: "publisher", holder: "00000000000000aa" as TokenId };

/** The waiting logins `beginLogin` keeps of all visitors together. */
const PLACES = 50;

/** The visitors that hold the places between them, three logins each. */
const VISITORS = 17;

/** The rows the batches of a database read and wrote, as the provider counts them toward a day's allowance. */
interface RowCounts {
  read: number;
  written: number;
}

async function emptyDatabase(): Promise<D1Driver> {
  await reset();

  return new D1Driver(BINDINGS.DB);
}

/** An empty database whose every batch adds the rows it read and wrote to `rows`. */
async function meteredDatabase(): Promise<{ readonly driver: D1Driver; readonly rows: RowCounts }> {
  await reset();
  const rows: RowCounts = { read: 0, written: 0 };

  const metered: Pick<D1Database, "prepare" | "batch"> = {
    prepare: (sql) => BINDINGS.DB.prepare(sql),
    async batch<Row = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<Row>[]> {
      const results = await BINDINGS.DB.batch<Row>(statements);

      for (const { meta } of results) {
        rows.read += meta.rows_read;
        rows.written += meta.rows_written;
      }

      return results;
    },
  };

  return { driver: new D1Driver(metered as D1Database), rows };
}

/** An install over an empty database whose every batch adds the rows it read and wrote to `rows`. */
async function meteredInstall(): Promise<{ readonly install: Install; readonly rows: RowCounts }> {
  const { driver, rows } = await meteredDatabase();
  const opened = await openDatabase(driver, NOW);
  if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

  const install: Install = {
    database: opened.database,
    store: new MemoryStore(),
    now: () => NOW,
    addressOf: (label) => `https://${label}.example.com`,
    publicAddressOf: (name) => `https://${name}.example.com`,
    reservedNames: new Set(),
  };

  return { install, rows };
}

/** Publish a new site of `files` pages of four bytes each through the three steps; answers the rows the whole of it read and wrote. */
async function publishCost(files: number): Promise<RowCounts> {
  const { install, rows } = await meteredInstall();
  await install.database.initSettings(defaultSettings({ installer: "ada@example.com" as Login, hostname: "poplin.example.com" }), { by: PUBLISHER.holder, at: NOW });
  const paths = ["index.html", ...Array.from(Array(files - 1).keys(), (index) => `pages/${index}.html`)];
  rows.read = 0;
  rows.written = 0;

  const begun = await beginPublish(install, PUBLISHER, { name: "report", files: paths.map((path) => ({ path, size: 4, content_type: "text/html" })) });
  if (!begun.ok) throw new Error(`the publish was refused: ${begun.code}`);

  for (const path of paths) await uploadFile(install, PUBLISHER, { upload: begun.upload.id, path, body: new Blob(["page"]).stream() });

  const finished = await finishPublish(install, PUBLISHER, begun.upload.id);
  if (!finished.ok) throw new Error(`the publish was not finished: ${finished.code}`);

  return { ...rows };
}

describeDatabase("D1", sqlDatabaseOver(emptyDatabase));
describeSqlDriver("D1", emptyDatabase);

describe("D1: the rows a publish costs of a day's allowance", () => {
  // Drift: the provider counts every entry of a JSON value a statement walks as a row read, and a publish asks for a file once per file; a lookup that walked the manifest read as many rows as the publish had files, squared.
  test.each([3, 5000])("one file of an upload of %d files is read as one row, and so is its whole manifest", async (files) => {
    const { driver, rows } = await meteredDatabase();
    const opened = await openDatabase(driver, NOW);
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

    const upload = await begunFiles(opened.database, numberedFiles(files));
    rows.read = 0;
    rows.written = 0;
    const one = await opened.database.getUploadFile(upload, "page-2.html");
    const lookup = { ...rows };
    const whole = await opened.database.getUpload(upload);

    expect([one?.file?.size, whole?.manifest.length]).toEqual([2, files]);
    expect([lookup, rows]).toEqual([{ read: 1, written: 0 }, { read: 2, written: 0 }]);
  });

  // Drift: the files of a day are counted so that the bucket's free month is not passed. A count kept a row per file, or one that read the days before, would spend the database's day to guard the bucket's month.
  test.each([3, 5000])("recording an upload of %d files reads 14 rows and writes 6, whatever it holds: two read and one written are the day's count", async (files) => {
    const { driver, rows } = await meteredDatabase();
    const opened = await openDatabase(driver, NOW);
    if (opened.kind !== "open") throw new Error(`the database did not open: ${opened.kind}`);

    await begunFiles(opened.database, numberedFiles(3));
    rows.read = 0;
    rows.written = 0;
    await begunFiles(opened.database, numberedFiles(files));

    expect(rows).toEqual({ read: 14, written: 6 });
  });

  // Drift: a day allows 5,000,000 rows read and 100,000 written, and every query fails once either is spent; a publish whose cost grew faster than its files would spend a day in one go.
  test.each([50, 200])("a whole publish of %d files reads at most two rows a file and 60 more, and writes at most 30", async (files) => {
    const cost = await publishCost(files);

    expect([cost.read <= 2 * files + 60, cost.written <= 30, cost]).toEqual([true, true, cost]);
  });
});

describe("D1: the rows a computer's login costs of a day's allowance", () => {
  // Drift: anyone may begin a login, and a day allows 5,000,000 rows read and 100,000 written. The room once cost 2,705 rows read a login, and a terminal's question one row written.
  test("with the fifty places held, a new login reads 58 rows and writes 4, and a terminal's question reads 1 and writes none", async () => {
    const { install, rows } = await meteredInstall();
    const begin = async (visitor: number): Promise<string> => {
      const begun = await beginLogin(install, { scope: "publisher", computer: "laptop" }, `visitor-${visitor}`);
      if (!begun.ok) throw new Error(`the login was refused: ${begun.code}`);

      return begun.secret;
    };
    for (let place = 0; place < PLACES; place += 1) await begin(place % VISITORS);

    rows.read = 0;
    rows.written = 0;
    const secret = await begin(VISITORS);
    const begun = { ...rows };
    const asked = await redeemLogin(install, { secret });

    expect([asked, begun, rows]).toEqual([{ ok: true, state: "pending" }, { read: 58, written: 4 }, { read: 59, written: 4 }]);
  });
});
