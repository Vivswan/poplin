import { describe, expect, test } from "bun:test";

import { type DeployConfig, keepCopyConfig } from "../../src/deploy/kept-config";

/** A release's configuration: newer than the copy's in its date, its sweep, a second bucket, and a field on the database, it uploads its source map, and it keeps the Worker's log. */
const RELEASE: DeployConfig = {
  name: "poplin",
  main: "packages/cloudflare/src/worker/worker.ts",
  compatibility_date: "2027-03-01",
  keep_vars: true,
  upload_source_maps: true,
  observability: { enabled: true, logs: { enabled: true, invocation_logs: false } },
  triggers: { crons: ["*/5 * * * *"] },
  r2_buckets: [
    { binding: "SITES", bucket_name: "poplin-sites" },
    { binding: "ARCHIVE", bucket_name: "poplin-archive" },
  ],
  d1_databases: [{ binding: "DB", database_name: "poplin", migrations_dir: "steps" }],
  vars: { WORKER_NAME: "poplin" },
};

describe("keepCopyConfig", () => {
  const merges: readonly { readonly name: string; readonly copy: DeployConfig; readonly merged: DeployConfig }[] = [
    {
      name: "a copy the Deploy button wrote ids and the person's own names into",
      copy: {
        name: "my-sites",
        account_id: "0123456789abcdef0123456789abcdef",
        main: "old/worker.ts",
        compatibility_date: "2026-11-01",
        upload_source_maps: false,
        observability: { enabled: false, logs: { enabled: true, invocation_logs: true } },
        triggers: { crons: ["*/15 * * * *"] },
        r2_buckets: [
          { binding: "SITES", bucket_name: "my-bucket", jurisdiction: "eu", preview_bucket_name: "local" },
          { binding: "GONE", bucket_name: "a-bucket-the-release-dropped" },
        ],
        d1_databases: [{ binding: "DB", database_name: "my-database", database_id: "11111111-2222-3333-4444-555555555555", preview_database_id: "local" }],
        vars: { WORKER_NAME: "stale", EXTRA: "1" },
      },
      merged: {
        ...RELEASE,
        name: "my-sites",
        account_id: "0123456789abcdef0123456789abcdef",
        r2_buckets: [
          { binding: "SITES", bucket_name: "my-bucket", jurisdiction: "eu" },
          { binding: "ARCHIVE", bucket_name: "poplin-archive" },
        ],
        d1_databases: [{ binding: "DB", database_name: "my-database", database_id: "11111111-2222-3333-4444-555555555555", migrations_dir: "steps" }],
        vars: { WORKER_NAME: "my-sites" },
      },
    },
    {
      name: "a copy with no ids and no lists at all",
      copy: { name: "poplin" },
      merged: RELEASE,
    },
    {
      name: "a copy whose lists are no lists",
      copy: { name: "poplin", r2_buckets: "SITES", d1_databases: [null, "DB"] },
      merged: RELEASE,
    },
  ];

  // Drift: a deploy that loses the copy's database id or name makes a new empty database or a second Worker; one that keeps the copy's old date or entry point deploys the release wrongly.
  test.each(merges)("$name: the copy wins its name, in both places it is written, its account, and which bucket and database, and the release wins everything else", ({ copy, merged }) => {
    expect(keepCopyConfig(RELEASE, copy)).toEqual(merged);
  });

  test("a release with no list of databases gets none from the copy: which bindings exist is the release's to say", () => {
    const release = { name: "poplin", r2_buckets: RELEASE.r2_buckets };

    expect(keepCopyConfig(release, { d1_databases: [{ binding: "DB", database_id: "11111111-2222-3333-4444-555555555555" }] })).toEqual(release);
  });
});
