// Remove the token row of this live run, and of any live run older than a day, whatever happened to the run: the workflow calls it when the steps before it failed or were cancelled.

import { findDatabase, removeTokens } from "./tokens";
import { openRun, reportStop } from "./util";

const run = openRun();
const database = await findDatabase(run);
const stopped = typeof database === "string" ? await removeTokens(run, database, Date.now()) : database;

if (stopped !== undefined) process.exitCode = reportStop(run, stopped, "The token rows could not be removed");
