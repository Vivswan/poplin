// The real API of an install, answering every request this process sends: for a child `poplin mcp` that a test starts.

import { ORIGIN, openApi } from "../../../../app/tests/api/support/install";

/**
 * Open a fresh install in this process, send every `fetch` to it, and put its admin's login into the environment.
 *
 * No request leaves the process from then on.
 */
export async function installInProcess(): Promise<void> {
  const install = await openApi();

  process.env.POPLIN_SERVER = ORIGIN;
  process.env.POPLIN_TOKEN = install.tokens.admin;
  globalThis.fetch = Object.assign((input: string | URL | Request, init?: RequestInit) => install.api.fetch(new Request(input, init)), {
    preconnect: fetch.preconnect,
  });
}
