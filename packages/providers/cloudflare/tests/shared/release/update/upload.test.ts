// The upload of a release by a repair, with a person's token in place of the kept key, against a stand-in for Cloudflare's API.
// Without these a release that keeps a binding the Worker lacks could go in with that binding dropped, or be sent by a repair that has no first value for it.

import { expect, test } from "bun:test";
import type { CheckedBundle } from "../../../../src/shared/release/update/bundle-files";
import { openUpload } from "../../../../src/shared/release/update/upload";
import { bodyOf, reply } from "../../install/support/replies";

/** The Worker that is replaced. */
const WORKER = { accountId: "0123456789abcdef0123456789abcdef", script: "poplin" };

/** A release that keeps two bindings by name, as its checked files hold it. */
const BUNDLE: CheckedBundle = {
  version: "0.3.0",
  deploy: {
    main_module: "worker.js",
    compatibility_date: "2026-11-01",
    compatibility_flags: [],
    bindings: [
      { name: "WORKER_NAME", kind: "kept" },
      { name: "DB", kind: "kept" },
    ],
    crons: [],
  },
  module: new TextEncoder().encode("export default {};\n"),
  map: undefined,
};

/** The first value a repair has for the database's binding. */
const FIRST_DB = { name: "DB", type: "d1", id: "made-0" };

/** Send one upload by a repair to a Worker that lacks the database's binding, and answer how it ended with the bindings of each upload the stand-in took. */
async function sentBy(first: (lacking: readonly string[]) => readonly (typeof FIRST_DB)[] | undefined): Promise<{ readonly put: unknown; readonly sent: unknown[] }> {
  const sent: unknown[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    if (request.url.startsWith("data:")) return new Response("");

    if (request.method === "PUT") sent.push(((await bodyOf(request)) as { readonly metadata: { readonly bindings: unknown } }).metadata.bindings);

    return reply(request.url.endsWith("/schedules") ? { schedules: [] } : { bindings: [{ name: "WORKER_NAME", type: "plain_text" }] });
  };
  const upload = await openUpload({ connection: { key: "token-of-the-test", baseUrl: "http://localhost/client/v4", fetch } }, WORKER, { by: "repair", first });

  return { put: upload.ok ? await upload.value.put(BUNDLE, undefined) : upload, sent };
}

// Drift: the key makes no database, so the install's own update refuses such a release. A repair that sent it as the update does would have Cloudflare drop the binding, or refuse the upload.
test("a repair states the first value of a binding the release keeps and the Worker lacks, keeps the rest by name, and states no update where it was handed none", async () => {
  const lacking: (readonly string[])[] = [];
  const { put, sent } = await sentBy((names) => {
    lacking.push(names);

    return [FIRST_DB];
  });

  expect([put, lacking, sent]).toEqual([{ ok: true }, [["DB"]], [[{ name: "WORKER_NAME", type: "inherit" }, FIRST_DB]]]);
});

// Drift: a binding with no first value here is one a newer poplin makes. An upload without it would put in place code whose binding is absent.
test("a repair that has no first value for such a binding sends nothing, as the install's own update does", async () => {
  expect(await sentBy(() => undefined)).toEqual({ put: { ok: false, refusal: "needs_hand" }, sent: [] });
});
