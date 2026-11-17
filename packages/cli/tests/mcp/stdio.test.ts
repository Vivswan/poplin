import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { cleanUp, folderOf } from "../commands/support/harness";
import { openMcp, protocolMessages } from "./support/bench";
import { installInProcess } from "./support/in-process-install";

/** The command's entry, as a path. */
const BIN = join(import.meta.dir, "..", "..", "src", "bin.ts");

/** The module that puts an install into the child, as a path. */
const SUPPORT = join(import.meta.dir, "support", "in-process-install.ts");

/** What the child runs: the real API in its own process behind `fetch`, then the command itself as `poplin mcp`. */
const CHILD = [
  `import { ${installInProcess.name} } from ${JSON.stringify(SUPPORT)};`,
  `await ${installInProcess.name}();`,
  `process.argv = [process.argv[0], ${JSON.stringify(BIN)}, "mcp"];`,
  `await import(${JSON.stringify(BIN)});`,
].join("\n");

/** What a client opens a session with. */
const HELLO = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "a test", version: "1.0.0" } };

interface Message {
  readonly id?: number;
  readonly result?: {
    readonly tools?: readonly { readonly name: string }[];
    readonly isError?: boolean;
    readonly structuredContent?: { readonly site?: { readonly label: string; readonly url: string } };
  };
}

afterEach(cleanUp);

describe("poplin mcp over stdio", () => {
  test("a whole session as its own process writes protocol messages on stdout and nothing else, and exits 0 when stdin closes: one stray line breaks the agent's connection", async () => {
    const cwd = folderOf("work", { "report/index.html": "<title>Report</title>", "report/.env": "SECRET=1" });
    const child = spawn(process.execPath, ["-e", CHILD], {
      cwd,
      env: { ...process.env, POPLIN_CONFIG_DIR: join(cwd, "config") },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const answers = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const stdout: string[] = [];
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const ask = async (id: number, method: string, params: unknown): Promise<Message> => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      const { value } = await answers.next();
      stdout.push(String(value));

      return JSON.parse(String(value));
    };

    await ask(1, "initialize", HELLO);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const listed = await ask(2, "tools/list", {});
    const made = await ask(3, "tools/call", { name: "publish_site", arguments: { path: "report" } });
    const shown = await ask(4, "tools/call", { name: "get_site", arguments: { site: made.result?.structuredContent?.site?.label } });
    child.stdin.end();
    const [code] = await once(child, "exit");
    for await (const line of { [Symbol.asyncIterator]: () => answers }) stdout.push(line);

    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(protocolMessages(stdout).map((message) => ("id" in message ? message.id : "none"))).toEqual([1, 2, 3, 4]);
    expect(listed.result?.tools?.map((tool) => tool.name)).toHaveLength(9);
    expect({ made: made.result?.isError, shown: shown.result?.isError }).toEqual({ made: undefined, shown: undefined });
    expect(shown.result?.structuredContent?.site?.url).toBe(made.result?.structuredContent?.site?.url ?? "no address");
  }, 30_000);

  test("lines that are no message, calls that are refused, and a publish leave nothing on stdout but protocol messages: an error printed there is read as a broken server", async () => {
    const bench = await openMcp(folderOf("home", {}));

    for (const line of [
      "",
      "not json",
      "{}",
      "[]",
      '{"jsonrpc":"2.0","id":90,"method":"no/such/method"}',
      '{"jsonrpc":"2.0","id":91,"method":"tools/call","params":{}}',
    ])
      bench.write(line);
    await bench.call("publish_site", { path: folderOf("report", { "index.html": "<title>Report</title>" }) });
    await bench.call("get_site", { site: "zzzzzzzzzzzz" });
    await bench.call("delete_site", { site: 4 });
    const code = await bench.close();

    expect(code).toBe(0);
    expect(protocolMessages(bench.written).length).toBeGreaterThanOrEqual(6);
    expect(bench.logged.filter((line) => !line.startsWith("poplin mcp: "))).toEqual([]);
  });

  test("a server whose stdin is closed before it starts exits 0 and writes nothing: one that waits on a closed stdin stays behind as a stray process", async () => {
    const cwd = folderOf("work", { "index.html": "<title>Work</title>" });
    const child = spawn(process.execPath, ["-e", CHILD], {
      cwd,
      env: { ...process.env, POPLIN_CONFIG_DIR: join(cwd, "config") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    const [code] = await once(child, "exit");

    expect({ code, stdout }).toEqual({ code: 0, stdout: "" });
  }, 30_000);

  // Drift: a tool call runs the command a person runs; a server stopped while a publish is on its way would leave the upload to hold its place for a day.
  test("a server the person stops gives up the upload of a publish on its way before it exits 1", async () => {
    const bench = await openMcp(folderOf("home", {}));
    const exited = Promise.withResolvers<number>();
    bench.hook = (request) => {
      if (request.method !== "PUT") return undefined;

      setTimeout(() => exited.resolve(bench.stop()), 5);

      return new Promise<Response>(() => undefined);
    };

    void bench.call("publish_site", { path: folderOf("report", { "index.html": "<title>Report</title>" }) }).catch(() => undefined);
    const code = await exited.promise;
    const { uploads } = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });

    expect(code).toBe(1);
    expect([bench.sent.at(-1)?.slice(0, 20), uploads.map((upload) => upload.state), bench.logged]).toEqual(["DELETE /api/uploads/", ["abandoned"], ["poplin mcp: server stopped"]]);
  });
});
