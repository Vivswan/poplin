import { expect, test } from "bun:test";

import { bytesOf, describeObjectStore, objectKey, readText } from "../../../core/tests/storage/support/storage-contract";
import { KeptStore } from "../../src/browser/kept-store";

describeObjectStore("the kept store", () => new KeptStore());

test("a store opened from a save holds the same objects under the same etags, and its next write gets an etag no object ever had: without this a browser's cached copy of a file answers for another after the demo was stopped", async () => {
  const first = new KeptStore();
  const kept = await first.write(objectKey("site/v1/index.html"), bytesOf("<h1>one</h1>"), { contentType: "text/html" });
  const gone = await first.write(objectKey("site/v1/old.css"), bytesOf("a {}"), { contentType: "text/css" });
  await first.delete(gone.key);

  const second = new KeptStore(first.save());
  const next = await second.write(objectKey("site/v2/index.html"), bytesOf("<h1>two</h1>"), { contentType: "text/html" });

  expect(await second.head(kept.key)).toEqual({ kind: "found", info: kept });
  expect(await readText(second, kept.key)).toEqual(await readText(first, kept.key));
  expect(await second.read(kept.key, { ifNoneMatch: kept.etag })).toEqual({ kind: "not-modified", info: kept });
  expect([kept.etag, gone.etag]).not.toContain(next.etag);
  expect((await first.head(next.key)).kind).toBe("missing");
});
