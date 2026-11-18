import { EXAMPLE_DASHBOARD } from "./example";

/** One kind of install: the key the picker switches on, its plain name, the one command that makes it, and the command that logs a machine in to it. */
interface Install {
  readonly id: string;
  readonly name: string;
  readonly line: string;
  readonly login: string;
}

/** The two kinds of install, the first being the one the page is built showing. */
export const INSTALLS: readonly Install[] = [
  { id: "domain", name: "With a domain", line: "npx poplin install cloudflare --domain example.com", login: `npx poplin login --server https://${EXAMPLE_DASHBOARD}` },
  { id: "no-domain", name: "Without a domain", line: "npx poplin install cloudflare --no-domain", login: "npx poplin login --server https://poplin.your-name.workers.dev" },
];
