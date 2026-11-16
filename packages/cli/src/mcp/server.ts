// The MCP server: the tools, registered with the SDK and served over one transport. Nothing leaves it with a token in it.

import { type CallToolResult, McpServer, type StandardSchemaWithJSON, type Transport } from "@modelcontextprotocol/server";
import { type StdioServerHandle, serveStdio } from "@modelcontextprotocol/server/stdio";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";

import { TOOL_INPUTS } from "../../../core/src/actions/tool-inputs";
import { problem, problemLines } from "../commands/problems";
import type { Outcome } from "../commands/records";
import { VERSION } from "../poplin";
import type { Host } from "./records";
import { TOOLS, type ToolName } from "./tools";
import { toolWords } from "./words";

/** The name the server gives itself. */
const NAME = "poplin";

/** What an agent is told once, when it connects. */
const INSTRUCTIONS =
  "Poplin publishes static sites to the user's own install. " +
  "A site is private unless the user asks otherwise. Name a site by the label a publish answered, and hand the user the url of an answer as it is: it changes when a site becomes private or stops being private.";

/** What a tool answers when its command printed no line. */
const DONE = "done";

/** The key under which a JSON Schema names its dialect. */
const DIALECT_KEY = "$schema";

/** The dialect the protocol reads a schema in when the schema names none. */
const DIALECT = "draft-2020-12";

/** The rules of a schema the converter cannot turn into JSON Schema: a `check` is a function. They are left out of the listing alone: a call is checked against the whole schema. */
const UNLISTED_RULES = ["check"];

/** Who the schema handed to the SDK is by. */
const VENDOR = "poplin";

/** Every tool, in the order core lists the site actions. */
const TOOL_NAMES = Object.keys(TOOL_INPUTS) as readonly ToolName[];

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}

/**
 * A tool's input as the SDK takes it: the JSON Schema of core's schema for the listing, with what the tool says of each argument.
 *
 * The SDK is handed no check of its own: the tool checks a call against core's schema itself, and so refuses one with a code of the problems table.
 *
 * @throws when the listing is asked for and a schema holds something the converter cannot turn into JSON Schema, but for the rules left out by name
 */
function inputOf(name: ToolName): StandardSchemaWithJSON<unknown, unknown> {
  const about: Readonly<Record<string, string>> = TOOLS[name].parameters;

  const listed = (): Record<string, unknown> => {
    const json = toJsonSchema(TOOL_INPUTS[name], { target: DIALECT, ignoreActions: UNLISTED_RULES });
    const properties = Object.entries(record(json.properties)).map(([key, property]) => [key, { ...record(property), description: about[key] }]);

    // The dialect line is left out of every tool: the protocol reads a schema without one as its default dialect.
    return { ...json, properties: Object.fromEntries(properties), [DIALECT_KEY]: undefined };
  };

  return { "~standard": { version: 1, vendor: VENDOR, validate: (value) => ({ value }), jsonSchema: { input: listed, output: listed } } };
}

/** Why a call is no input of its tool: every argument the schema refused, with the schema's own sentence. */
function refusalOf(issues: readonly v.BaseIssue<unknown>[]): Outcome {
  const about = issues.map((issue) => `${v.getDotPath(issue) ?? "arguments"}: ${issue.message}`).join("; ");

  return { ok: false, problem: problem("bad_argument", about) };
}

/**
 * What a tool call answers: the command's lines as text and the install's answer as the structured content, or a problem as a tool error with its code.
 * A hint, a step, and a note name the tool where they name a command; a line of the result holds a site's own words, and stays as it is.
 */
function resultOf(outcome: Outcome): CallToolResult {
  if (!outcome.ok) {
    const said = outcome.problem.hint === undefined ? outcome.problem : { ...outcome.problem, hint: toolWords(outcome.problem.hint) };
    const { code, message, about, hint } = said;

    return {
      isError: true,
      content: [{ type: "text", text: `${code}: ${problemLines(said).join("\n")}` }],
      structuredContent: { error: { code, message, about, hint } },
    };
  }

  const lines = [...outcome.lines, ...[...(outcome.steps ?? []), ...(outcome.notes ?? [])].map(toolWords)];

  return { content: [{ type: "text", text: lines.length === 0 ? DONE : lines.join("\n") }], structuredContent: record(outcome.value) };
}

async function answerOf<Name extends ToolName>(name: Name, input: unknown, host: Host): Promise<CallToolResult> {
  const checked = v.safeParse(TOOL_INPUTS[name], input);
  if (!checked.success) return resultOf(refusalOf(checked.issues));

  try {
    return resultOf(await TOOLS[name].run(checked.output, host));
  } catch (error) {
    const what = error instanceof Error ? `${error.name}: ${error.message}` : "an unknown failure";

    return resultOf({ ok: false, problem: problem("crashed", what) });
  }
}

/** Register one tool. Each call of it is in `running` until it has its answer. */
function register<Name extends ToolName>(server: McpServer, name: Name, host: Host, running: Set<Promise<CallToolResult>>): void {
  const tool = TOOLS[name];

  server.registerTool(name, { description: tool.description, inputSchema: inputOf(name), annotations: tool.hints }, async (input) => {
    const answer = answerOf(name, input, host);
    running.add(answer);

    try {
      return await answer;
    } finally {
      running.delete(answer);
    }
  });
}

function createServer(host: Host, running: Set<Promise<CallToolResult>>): McpServer {
  const server = new McpServer({ name: NAME, version: VERSION }, { instructions: INSTRUCTIONS });

  for (const name of TOOL_NAMES) register(server, name, host, running);

  return server;
}

/**
 * Serve the tools over one transport, until it closes or the handle is closed.
 *
 * Every message the server sends passes the host's token guard on its way out: a result, an error, and what the SDK echoes of a call alike.
 *
 * @param transport - the connection to one agent, which the server starts and from then on owns
 * @returns what closes the connection, once every tool call on its way has its answer: a call that is giving an upload up is not cut off
 */
export function serveMcp(host: Host, transport: Transport): Pick<StdioServerHandle, "close"> {
  const running = new Set<Promise<CallToolResult>>();
  const send = transport.send.bind(transport);
  transport.send = async (message, options) => send(await host.withoutTokens(message), options);

  const served = serveStdio(() => createServer(host, running), {
    transport,
    onerror: (error) => {
      void host.withoutTokens(`poplin mcp: ${error.message}`).then(host.log);
    },
  });

  return {
    close: async () => {
      await Promise.allSettled(running);
      await served.close();
    },
  };
}
