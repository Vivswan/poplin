import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describeDatabase } from "@poplin/core/tests/database-contract";

import type { Bindings } from "../src/bindings";
import { D1Driver } from "../src/d1";

const BINDINGS: Bindings = env;

async function emptyDatabase(): Promise<D1Driver> {
  await reset();

  return new D1Driver(BINDINGS.DB);
}

describeDatabase("D1", emptyDatabase);
