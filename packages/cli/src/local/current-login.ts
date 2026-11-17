// The current login: who the command is talking to, and with which token.

import { type Login, parseLogin } from "./login";
import { type Machine, readLoginFile, thisMachine } from "./login-file";

/** The variables of the environment a command reads a token from: the login's, and the account token of the install commands. */
export const TOKEN_VARIABLES = { login: "POPLIN_TOKEN", install: "POPLIN_INSTALL_TOKEN" } as const;

/** The variable the install's address is read from. */
const SERVER = "POPLIN_SERVER";

/** The variable the login's token is read from. */
const TOKEN = TOKEN_VARIABLES.login;

/** Who the command is talking to. `source` says where a login came from; `refused` carries what is wrong and the line that names the fix. */
type CurrentLogin =
  | { readonly state: "logged-in"; readonly login: Login; readonly source: "environment" | "file" }
  | { readonly state: "logged-out" }
  | { readonly state: "refused"; readonly message: string; readonly fix: string };

function refuse(message: string, fix: string): { readonly state: "refused"; readonly message: string; readonly fix: string } {
  return { state: "refused", message, fix: `Fix: ${fix}` };
}

/** A variable's value, with an empty one counted as not set. */
function setting(machine: Machine, name: string): string | undefined {
  const value = machine.env[name];

  return value === "" ? undefined : value;
}

function fromEnvironment(server: string, token: string): CurrentLogin {
  const parsed = parseLogin({ server, token });

  if (!parsed.ok) return refuse(`${SERVER} and ${TOKEN} are invalid: ${parsed.problem}`, "set both again, or unset both to use the stored login");

  return { state: "logged-in", login: parsed.login, source: "environment" };
}

/**
 * Find the login to use: `POPLIN_SERVER` and `POPLIN_TOKEN` when both are set, else the login file, else none.
 *
 * @returns `refused` when one of the two variables is set without the other, when the two are not a login, or when the login file is refused; the
 *   file is not read when the environment answers
 */
export async function currentLogin(machine: Machine = thisMachine()): Promise<CurrentLogin> {
  const server = setting(machine, SERVER);
  const token = setting(machine, TOKEN);

  if (server !== undefined && token !== undefined) return fromEnvironment(server, token);

  if (server !== undefined) return refuse(`${SERVER} is set without ${TOKEN}`, `set ${TOKEN} too, or unset ${SERVER} to use the stored login`);

  if (token !== undefined) return refuse(`${TOKEN} is set without ${SERVER}`, `set ${SERVER} too, or unset ${TOKEN} to use the stored login`);

  const saved = await readLoginFile(machine);

  if (saved.state === "missing") return { state: "logged-out" };

  if (saved.state === "refused") return saved;

  return { state: "logged-in", login: saved.login, source: "file" };
}
