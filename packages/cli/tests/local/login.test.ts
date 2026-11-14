import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempDisposableSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { currentLogin } from "../../src/local/current-login";
import { type Login, parseLogin } from "../../src/local/login";
import { clearLogin, loginFilePath, type Machine, readLoginFile, saveLogin } from "../../src/local/login-file";

const SERVER = "https://poplin.example.com";
const TOKEN = `poplin_${"0".repeat(16)}_${"a".repeat(64)}`;
const OTHER_SERVER = "https://other.example.com:8443";
const OTHER_TOKEN = "another-token";
const HAS_MODES = process.platform !== "win32";
const PERMISSION_BITS = 0o777;
const LOCATIONS: readonly { readonly name: string; readonly machine: Machine; readonly path: string }[] = [
  { name: "Linux", machine: { env: {}, platform: "linux", home: "/home/sam" }, path: "/home/sam/.config/poplin/login.json" },
  { name: "macOS", machine: { env: {}, platform: "darwin", home: "/people/sam" }, path: "/people/sam/.config/poplin/login.json" },
  { name: "XDG_CONFIG_HOME", machine: { env: { XDG_CONFIG_HOME: "/xdg" }, platform: "linux", home: "/home/sam" }, path: "/xdg/poplin/login.json" },
  { name: "XDG_CONFIG_HOME on macOS", machine: { env: { XDG_CONFIG_HOME: "/xdg" }, platform: "darwin", home: "/people/sam" }, path: "/xdg/poplin/login.json" },
  {
    name: "an empty XDG_CONFIG_HOME",
    machine: { env: { XDG_CONFIG_HOME: "" }, platform: "linux", home: "/home/sam" },
    path: "/home/sam/.config/poplin/login.json",
  },
  {
    name: "a relative XDG_CONFIG_HOME",
    machine: { env: { XDG_CONFIG_HOME: "xdg" }, platform: "linux", home: "/home/sam" },
    path: "/home/sam/.config/poplin/login.json",
  },
  {
    name: "Windows",
    machine: { env: { APPDATA: "C:\\Users\\sam\\AppData\\Roaming" }, platform: "win32", home: "C:\\Users\\sam" },
    path: "C:\\Users\\sam\\AppData\\Roaming\\poplin\\login.json",
  },
  {
    name: "Windows with no APPDATA",
    machine: { env: { XDG_CONFIG_HOME: "C:\\xdg" }, platform: "win32", home: "C:\\Users\\sam" },
    path: "C:\\Users\\sam\\AppData\\Roaming\\poplin\\login.json",
  },
  {
    name: "POPLIN_CONFIG_DIR",
    machine: { env: { POPLIN_CONFIG_DIR: "/chosen", XDG_CONFIG_HOME: "/xdg" }, platform: "linux", home: "/home/sam" },
    path: "/chosen/login.json",
  },
  {
    name: "POPLIN_CONFIG_DIR on Windows",
    machine: { env: { POPLIN_CONFIG_DIR: "D:\\chosen", APPDATA: "C:\\Roaming" }, platform: "win32", home: "C:\\Users\\sam" },
    path: "D:\\chosen\\login.json",
  },
  {
    name: "an empty POPLIN_CONFIG_DIR",
    machine: { env: { POPLIN_CONFIG_DIR: "" }, platform: "linux", home: "/home/sam" },
    path: "/home/sam/.config/poplin/login.json",
  },
];
const NOT_LOGINS: readonly { readonly name: string; readonly value: unknown }[] = [
  { name: "null", value: null },
  { name: "a string", value: SERVER },
  { name: "an array", value: [SERVER, TOKEN] },
  { name: "no fields", value: {} },
  { name: "no token", value: { server: SERVER } },
  { name: "no server", value: { token: TOKEN } },
  { name: "an extra field", value: { server: SERVER, token: TOKEN, version: 1 } },
  { name: "a renamed field", value: { address: SERVER, token: TOKEN } },
  { name: "a server that is not a string", value: { server: 1, token: TOKEN } },
  { name: "a token that is not a string", value: { server: SERVER, token: null } },
  { name: "a server over http", value: { server: "http://poplin.example.com", token: TOKEN } },
  { name: "a server with a path", value: { server: `${SERVER}/sites`, token: TOKEN } },
  { name: "a server with a closing slash", value: { server: `${SERVER}/`, token: TOKEN } },
  { name: "a server with a query", value: { server: `${SERVER}?next=1`, token: TOKEN } },
  { name: "a server with a fragment", value: { server: `${SERVER}#top`, token: TOKEN } },
  { name: "a server with credentials", value: { server: "https://sam:secret@poplin.example.com", token: TOKEN } },
  { name: "a server with no scheme", value: { server: "poplin.example.com", token: TOKEN } },
  { name: "a server with a space after it", value: { server: `${SERVER} `, token: TOKEN } },
  { name: "an empty server", value: { server: "", token: TOKEN } },
  { name: "an empty token", value: { server: SERVER, token: "" } },
  { name: "a token with a space", value: { server: SERVER, token: "to ken" } },
  { name: "a token with a line end", value: { server: SERVER, token: `${TOKEN}\n` } },
  { name: "a token with a tab", value: { server: SERVER, token: `\t${TOKEN}` } },
  { name: "a token with a control character", value: { server: SERVER, token: `${TOKEN}\u007f` } },
  { name: "a token outside ASCII", value: { server: SERVER, token: `${TOKEN}\u00e9` } },
];
const DAMAGED_FILES: readonly { readonly name: string; readonly text: string }[] = [
  { name: "an empty file", text: "" },
  { name: "half a file", text: `{"server":"${SERVER}","tok` },
  { name: "text that is not JSON", text: "logged in" },
  { name: "two logins", text: `{"server":"${SERVER}","token":"${TOKEN}"}{"server":"${SERVER}","token":"${TOKEN}"}` },
  { name: "an extra field beside a good login", text: JSON.stringify({ server: SERVER, token: TOKEN, version: 2 }) },
  { name: "a good token beside a bad server", text: JSON.stringify({ server: "http://poplin.example.com", token: TOKEN }) },
  { name: "a missing token", text: JSON.stringify({ server: SERVER }) },
];

function login(server: string, token: string): Login {
  const parsed = parseLogin({ server, token });

  if (!parsed.ok) throw new Error(parsed.problem);

  return parsed.login;
}

function machineIn(dir: string, env: Readonly<Record<string, string>> = {}): Machine {
  return { env: { POPLIN_CONFIG_DIR: dir, ...env }, platform: process.platform, home: dir };
}

function scratchDir(): { readonly path: string } & Disposable {
  return mkdtempDisposableSync(join(tmpdir(), "poplin-login-"));
}

function permissions(path: string): number {
  return statSync(path).mode & PERMISSION_BITS;
}

describe("loginFilePath", () => {
  test.each(LOCATIONS)("drift: each platform has its own per-user config folder, and a wrong one strands a saved login: $name", ({ machine, path }) => {
    expect(loginFilePath(machine)).toBe(path);
  });
});

describe("parseLogin", () => {
  test("drift: a login is the two facts as given, and the token may be any printable ASCII since the server owns its form", () => {
    expect<unknown>(parseLogin({ server: OTHER_SERVER, token: "!~" })).toEqual({ ok: true, login: { server: OTHER_SERVER, token: "!~" } });
  });

  test.each(NOT_LOGINS)("drift: a value that is nearly a login must be refused whole, never trimmed or defaulted into one: $name", ({ value }) => {
    const parsed = parseLogin(value);

    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain(TOKEN);
  });
});

describe("the login file", () => {
  test("drift: no file is 'not logged in', and a saved login reads back as saved", async () => {
    using dir = scratchDir();
    const machine = machineIn(join(dir.path, "not", "made", "yet"));

    expect(await readLoginFile(machine)).toEqual({ state: "missing" });

    await saveLogin(login(SERVER, TOKEN), machine);

    expect(await readLoginFile(machine)).toEqual({ state: "saved", login: login(SERVER, TOKEN) });
    expect(readFileSync(loginFilePath(machine), "utf8")).toBe(`{"server":"${SERVER}","token":"${TOKEN}"}\n`);
    expect(readdirSync(join(dir.path, "not", "made", "yet"))).toEqual(["login.json"]);
  });

  test.skipIf(!HAS_MODES)("drift: the file holds a token, so it and its folder are for the owner alone whatever the umask says", async () => {
    using dir = scratchDir();
    const machine = machineIn(join(dir.path, "config"));
    const umask = process.umask(0);

    try {
      await saveLogin(login(SERVER, TOKEN), machine);
    } finally {
      process.umask(umask);
    }

    expect(permissions(join(dir.path, "config"))).toBe(0o700);
    expect(permissions(loginFilePath(machine))).toBe(0o600);
  });

  test.skipIf(!HAS_MODES)("drift: saving replaces the file, so a file other users could read does not lend its mode to the new login", async () => {
    using dir = scratchDir();
    const machine = machineIn(dir.path);

    writeFileSync(loginFilePath(machine), "damaged", { mode: 0o644 });
    await saveLogin(login(OTHER_SERVER, OTHER_TOKEN), machine);

    expect(permissions(loginFilePath(machine))).toBe(0o600);
    expect(await readLoginFile(machine)).toEqual({ state: "saved", login: login(OTHER_SERVER, OTHER_TOKEN) });
  });

  test.skipIf(!HAS_MODES).each([0o644, 0o640, 0o604, 0o660])("drift: a login other users can read is refused with the fix, mode %o", async (mode) => {
    using dir = scratchDir();
    const machine = machineIn(dir.path);

    await saveLogin(login(SERVER, TOKEN), machine);
    chmodSync(loginFilePath(machine), mode);

    const answer = await readLoginFile(machine);

    expect(answer).toEqual({ state: "refused", message: expect.stringContaining("run `chmod 600` on it") });
    expect(answer).toEqual({ state: "refused", message: expect.stringContaining("`poplin login`") });
  });

  test.each(DAMAGED_FILES)("drift: a damaged file is refused whole, with the fix and without the token: $name", async ({ text }) => {
    using dir = scratchDir();
    const machine = machineIn(dir.path);

    writeFileSync(loginFilePath(machine), text, { mode: 0o600 });

    const answer = await readLoginFile(machine);

    expect(answer).toEqual({ state: "refused", message: expect.stringContaining("run `poplin login` again") });
    expect(JSON.stringify(answer)).not.toContain(TOKEN);
    expect(readFileSync(loginFilePath(machine), "utf8")).toBe(text);
  });

  test("drift: a folder where the file should be is refused, never thrown at the user", async () => {
    using dir = scratchDir();
    const machine = machineIn(dir.path);

    mkdirSync(loginFilePath(machine));

    expect(await readLoginFile(machine)).toEqual({ state: "refused", message: expect.stringContaining("is not a file") });
  });

  test.skipIf(!HAS_MODES)("drift: opening a named pipe waits for a writer, so one where the file should be must be refused without waiting", async () => {
    using dir = scratchDir();
    const machine = machineIn(dir.path);

    execFileSync("mkfifo", ["-m", "600", loginFilePath(machine)]);

    expect(await readLoginFile(machine)).toEqual({ state: "refused", message: expect.stringContaining("is not a file") });
  });

  test("drift: a save that was cut short leaves its half-written file beside the login, and that file is never read", async () => {
    using dir = scratchDir();
    const machine = machineIn(dir.path);

    writeFileSync(join(dir.path, ".login.json.cut-short.tmp"), `{"server":"${OTHER_SERVER}","tok`);

    expect(await readLoginFile(machine)).toEqual({ state: "missing" });

    await saveLogin(login(SERVER, TOKEN), machine);

    expect(await readLoginFile(machine)).toEqual({ state: "saved", login: login(SERVER, TOKEN) });
  });

  test("drift: a save that fails removes what it wrote, so no copy of the token is left beside the login file", async () => {
    using dir = scratchDir();
    const machine = machineIn(dir.path);

    mkdirSync(loginFilePath(machine));

    await expect(saveLogin(login(SERVER, TOKEN), machine)).rejects.toThrow();
    expect(readdirSync(dir.path)).toEqual(["login.json"]);
  });

  test("drift: logging out removes the login, and logging out twice is not an error", async () => {
    using dir = scratchDir();
    const machine = machineIn(dir.path);

    await saveLogin(login(SERVER, TOKEN), machine);
    await clearLogin(machine);

    expect(readdirSync(dir.path)).toEqual([]);

    await clearLogin(machine);
    await clearLogin(machineIn(join(dir.path, "never", "made")));

    expect(await readLoginFile(machine)).toEqual({ state: "missing" });
  });
});

describe("currentLogin", () => {
  test("drift: with no environment the saved login answers, and with none saved the answer is 'logged out'", async () => {
    using dir = scratchDir();
    const machine = machineIn(dir.path);

    expect(await currentLogin(machine)).toEqual({ state: "logged-out" });

    await saveLogin(login(SERVER, TOKEN), machine);

    expect(await currentLogin(machine)).toEqual({ state: "logged-in", login: login(SERVER, TOKEN), source: "file" });
    expect(await currentLogin(machineIn(dir.path, { POPLIN_SERVER: "", POPLIN_TOKEN: "" }))).toEqual({
      state: "logged-in",
      login: login(SERVER, TOKEN),
      source: "file",
    });
  });

  test("drift: CI sets both variables, and they must win over a saved login and over a damaged one", async () => {
    using dir = scratchDir();
    const machine = machineIn(dir.path, { POPLIN_SERVER: OTHER_SERVER, POPLIN_TOKEN: OTHER_TOKEN });
    const fromEnvironment = { state: "logged-in", login: login(OTHER_SERVER, OTHER_TOKEN), source: "environment" } as const;

    expect(await currentLogin(machine)).toEqual(fromEnvironment);

    await saveLogin(login(SERVER, TOKEN), machine);

    expect(await currentLogin(machine)).toEqual(fromEnvironment);

    writeFileSync(loginFilePath(machine), "damaged");

    expect(await currentLogin(machine)).toEqual(fromEnvironment);
  });

  test.each([
    { set: "POPLIN_SERVER", value: OTHER_SERVER, missing: "POPLIN_TOKEN" },
    { set: "POPLIN_TOKEN", value: OTHER_TOKEN, missing: "POPLIN_SERVER" },
  ])("drift: $set alone must not fall back to the saved login, which may be for another server", async ({ set, value, missing }) => {
    using dir = scratchDir();
    const machine = machineIn(dir.path, { [set]: value });

    await saveLogin(login(SERVER, TOKEN), machine);

    const answer = await currentLogin(machine);

    expect(answer).toEqual({ state: "refused", message: expect.stringContaining(`set ${missing} too`) });
    expect(JSON.stringify(answer)).not.toContain(OTHER_TOKEN);
  });

  test.each([
    { name: "a server with a path", env: { POPLIN_SERVER: `${OTHER_SERVER}/mcp`, POPLIN_TOKEN: OTHER_TOKEN } },
    { name: "a server over http", env: { POPLIN_SERVER: "http://other.example.com", POPLIN_TOKEN: OTHER_TOKEN } },
    { name: "a token with a space", env: { POPLIN_SERVER: OTHER_SERVER, POPLIN_TOKEN: `${OTHER_TOKEN} ` } },
  ])("drift: variables that are not a login are refused by name, never passed to the saved login: $name", async ({ env }) => {
    using dir = scratchDir();
    const machine = machineIn(dir.path, env);

    await saveLogin(login(SERVER, TOKEN), machine);

    const answer = await currentLogin(machine);

    expect(answer).toEqual({ state: "refused", message: expect.stringContaining("POPLIN_SERVER and POPLIN_TOKEN are not a login") });
    expect(JSON.stringify(answer)).not.toContain(OTHER_TOKEN);
  });

  test("drift: a refused file's message reaches the caller unchanged, since it names the fix", async () => {
    using dir = scratchDir();
    const machine = machineIn(dir.path);

    writeFileSync(loginFilePath(machine), "{", { mode: 0o600 });

    expect(await currentLogin(machine)).toEqual({ state: "refused", message: expect.stringContaining("run `poplin login` again") });
  });
});
