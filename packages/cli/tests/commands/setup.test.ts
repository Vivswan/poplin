import { afterEach, describe, expect, test } from "bun:test";

import type { DomainReading } from "../../../app/src/dashboard/domain/records";
import { createSetup } from "../../../app/src/dashboard/domain/setup";
import { MemoryCounters } from "../../../app/src/limits/memory-counters";
import { ORIGIN } from "../../../app/tests/api/support/install";
import { fakePlug, TOKEN, usualPlug } from "../../../app/tests/dashboard/domain/support/fake-plug";
import { type Bench, cleanUp, jsonOf, openBench } from "./support/harness";

/** The environment of a person who has a provider's token and no login. */
const ENV = { POPLIN_SETUP_TOKEN: TOKEN };

/** The secret the setup page signs its forms with: 32 bytes, as the page asks. */
const SECRET = new Uint8Array(32).fill(7);

/** The command line of a setup of the test install. */
const SETUP = `setup --server ${ORIGIN}`;

/** Put the install's real setup page in front of a bench, over a plug the test wrote. */
function withSetup(bench: Bench, plug: ReturnType<typeof fakePlug>, open = true): void {
  const setup = createSetup({
    install: { database: bench.install.database, now: () => bench.install.clock.now },
    domain: plug,
    open: async () => open,
    counters: new MemoryCounters(),
    visitorOf: async () => "203.0.113.7",
    csrfSecret: SECRET,
  });
  bench.hook = (request) => setup.fetch(request);
}

afterEach(cleanUp);

describe("poplin setup", () => {
  // Drift: the command and the install's setup page are two ends of one call; a path, a body, or a key renamed on one side would leave the terminal with no way to finish an install.
  test("a check prints the install's rows and exits as a failure while something is left; a repair prints what it made and exits clean; neither needs a login", async () => {
    const bench = await openBench();
    const plug = usualPlug();
    withSetup(bench, plug);

    const checked = await bench.run(`${SETUP} --check`, { env: ENV });
    const repaired = await bench.run(SETUP, { env: ENV });

    expect([checked.code, checked.out, checked.err]).toEqual([
      1,
      ["present   DNS record    *.example.com", "missing   DNS record    poplin.example.com", "present   Worker route  poplin.example.com/*", "left-out  Rate rule     rate rule: the domain has other hostnames", "1 to repair"],
      [],
    ]);
    expect([repaired.code, repaired.out.slice(1, 2), repaired.out.at(-1)]).toEqual([0, ["created   DNS record    poplin.example.com"], "the install's side is as it should be"]);
    expect(bench.sent).toEqual(["POST /setup/api/check", "POST /setup/api/repair"]);
    expect(plug.calls.map(({ run, token }) => [run, token])).toEqual([["check", TOKEN], ["repair", TOKEN]]);
  });

  // Drift: a step is the one thing the install cannot do for the person, and `--json` is what a script reads: both must come through whole.
  test("a step only a person can do is printed with its address on its own line, and --json prints the run, the rows, and the steps as one value", async () => {
    const bench = await openBench();
    const reading: DomainReading = { ok: true, rows: [{ object: "Login", state: "missing", detail: "the login is off for the account" }], steps: [{ text: "Switch the login on.", address: "https://provider.example.com/login" }] };
    withSetup(bench, fakePlug(() => reading));

    const plain = await bench.run(SETUP, { env: ENV });
    const json = await bench.run(`${SETUP} --json`, { env: ENV });

    expect([plain.code, plain.out]).toEqual([1, ["missing  Login  the login is off for the account", "Switch the login on.", "https://provider.example.com/login", "1 not done"]]);
    expect([json.code, jsonOf(json)]).toEqual([1, { run: "repair", rows: reading.rows, steps: reading.steps }]);
  });

  const refused: readonly { readonly name: string; readonly reading?: DomainReading; readonly open?: boolean; readonly code: number; readonly says: string }[] = [
    { name: "a token the provider refuses", reading: { ok: false, refusal: "token" }, code: 1, says: "the token was refused, or it is not of the install's own account" },
    { name: "a provider that does not answer", reading: { ok: false, refusal: "unreachable" }, code: 5, says: "the install got no answer from its provider" },
    { name: "a setup that is shut", open: false, code: 1, says: "nothing at that address takes a setup" },
  ];

  test.each(refused)("$name is said in its own sentence and prints no row", async ({ reading, open, code, says }) => {
    const bench = await openBench();
    withSetup(bench, fakePlug(() => reading ?? { ok: true, rows: [], steps: [] }), open ?? true);

    const ended = await bench.run(SETUP, { env: ENV });

    expect([ended.code, ended.err[0], ended.out]).toEqual([code, says, []]);
  });

  // Drift: the token opens the person's whole account at the provider; the command's own output is the one place it could reach a log or a screen.
  test("the token is in no line and no value, even when the answer hands it back, and it is sent in the body alone", async () => {
    const bench = await openBench();
    const bodies: string[] = [];
    bench.hook = async (request) => {
      bodies.push(`${request.url} ${await request.clone().text()}`);

      return Response.json({ ok: true, rows: [{ object: "DNS record", state: "created", detail: `made with ${TOKEN}` }], steps: [{ text: TOKEN, address: `https://example.com/?t=${TOKEN}` }] });
    };

    const plain = await bench.run(SETUP, { env: ENV });
    const json = await bench.run(`${SETUP} --json`, { env: ENV });
    const printed = [...plain.out, ...plain.err, ...json.out, ...json.err].join("\n");

    expect([printed.includes(TOKEN), plain.out[0]]).toEqual([false, "created  DNS record  made with [token]"]);
    expect(bodies).toEqual([`${ORIGIN}/setup/api/repair ${JSON.stringify({ token: TOKEN })}`, `${ORIGIN}/setup/api/repair ${JSON.stringify({ token: TOKEN })}`]);
  });

  // Drift: a followed redirect sends the request again, body and all, so an address that redirects would hand the token to whoever it names.
  test("a redirect is not followed: the token is sent to the address given once, and to no other", async () => {
    const bench = await openBench();
    const asked: string[] = [];
    bench.hook = (request) => {
      asked.push(`${request.redirect} ${request.url}`);

      // The body is one a done run answers with: under a redirect's status it is no answer of the setup.
      return Response.json({ ok: true, rows: [], steps: [] }, { status: 307, headers: { Location: "https://collector.example.net/capture" } });
    };

    const ended = await bench.run(SETUP, { env: ENV });

    expect([ended.code, ended.out, ended.err[0], asked]).toEqual([5, [], "the install answered in a form this poplin does not know: status 307", [`manual ${ORIGIN}/setup/api/repair`]]);
  });

  test("an address that answers a page instead of the setup's JSON is told apart from a refusal", async () => {
    const bench = await openBench();
    bench.hook = () => new Response("<html>a login page</html>", { status: 200, headers: { "Content-Type": "text/html" } });

    const ended = await bench.run(SETUP, { env: ENV });

    expect([ended.code, ended.err[0]]).toEqual([5, "the install answered in a form this poplin does not know: status 200"]);
  });

  // Drift: the first Ctrl-C no longer ends the process by itself; a setup that did not hear the stop would go on and print its rows as if nobody had stopped it.
  test("a setup the person stops while its request is on its way ends as stopped, and says the install may have had the request", async () => {
    const bench = await openBench();
    bench.hook = () => {
      setTimeout(bench.stop, 5);

      return new Promise<Response>(() => undefined);
    };

    const stopped = await bench.run(SETUP, { env: ENV });

    expect([stopped.code, stopped.out, stopped.err]).toEqual([1, [], ["the command was stopped", "the install may have had the request all the same; poplin setup --check shows what is left"]]);
  });
});
