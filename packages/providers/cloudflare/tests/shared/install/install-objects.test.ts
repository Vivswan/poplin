// wrangler.jsonc, which a deploy reads, against what the Worker's own code and a repair expect of the Worker.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workflowNameOf } from "../../../src/shared/jobs/workflow-name";
import { INSTALL_OBJECTS } from "../../../src/shared/install/install-objects";

// Drift: a deploy makes the Workflow wrangler.jsonc names, and a repair and the Worker's own code look for the one named after the Worker. Two names would be two Workflows, one bound and one checked.
test("wrangler.jsonc binds the Workflow of the class the table holds, named after the Worker as a repair names it", () => {
  const config = Bun.JSONC.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "..", "..", "..", "wrangler.jsonc"), "utf8")) as { name: string; workflows: unknown };

  expect(config.workflows).toEqual([{ name: workflowNameOf(config.name), binding: INSTALL_OBJECTS.jobsBinding, class_name: INSTALL_OBJECTS.jobsClass }]);
});

// Drift: a first upload whose release states no log setting sends the table's. Another setting there would make an install log unlike the Worker the release was built as.
test("wrangler.jsonc keeps the Worker's lines of every request and no record of the request itself, as the table holds", () => {
  const config = Bun.JSONC.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "..", "..", "..", "wrangler.jsonc"), "utf8")) as { observability: unknown };

  expect(config.observability).toEqual({
    enabled: INSTALL_OBJECTS.logsKept,
    head_sampling_rate: INSTALL_OBJECTS.logsShare,
    logs: { enabled: INSTALL_OBJECTS.logsKept, invocation_logs: INSTALL_OBJECTS.requestRecords },
  });
});
