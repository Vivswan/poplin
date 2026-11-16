// wrangler.jsonc, which a deploy reads, against what the Worker's own code and a repair expect of the Worker.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workflowNameOf } from "../../src/jobs/workflow-name";
import { INSTALL_OBJECTS } from "../../src/zone/install-objects";

// Drift: a deploy makes the Workflow wrangler.jsonc names, and a repair and the Worker's own code look for the one named after the Worker. Two names would be two Workflows, one bound and one checked.
test("wrangler.jsonc binds the Workflow of the class the table holds, named after the Worker as a repair names it", () => {
  const config = Bun.JSONC.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "..", "wrangler.jsonc"), "utf8")) as { name: string; workflows: unknown };

  expect(config.workflows).toEqual([{ name: workflowNameOf(config.name), binding: "JOBS", class_name: INSTALL_OBJECTS.jobsClass }]);
});
