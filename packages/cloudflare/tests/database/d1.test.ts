import { reset } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describeDatabase } from "@poplin/core/tests/database/support/database-contract";
import { describeSqlDriver, sqlDatabaseOver } from "@poplin/core/tests/database/support/sql-driver-contract";

import type { Bindings } from "../../src/worker/bindings";
import { D1Driver } from "../../src/database/d1";

const BINDINGS: Bindings = env;

async function emptyDatabase(): Promise<D1Driver> {
  await reset();

  return new D1Driver(BINDINGS.DB);
}

describeDatabase("D1", sqlDatabaseOver(emptyDatabase));
describeSqlDriver("D1", emptyDatabase);
