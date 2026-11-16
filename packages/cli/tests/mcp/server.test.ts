import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { dirname, join } from "node:path";

import { hc } from "hono/client";

import type { Api } from "../../../app/src/api/api";
import { answered, LIMITS, ORIGIN } from "../../../app/tests/api/support/install";
import { TOOL_INPUTS } from "../../../core/src/actions/tool-inputs";
import { cleanUp, folderOf } from "../commands/support/harness";
import { type Answer, type McpBench, openMcp } from "./support/bench";

/** The most bytes the tools listing may cost an agent's context. */
const LISTING_BUDGET = 7000;

/** An id in the form of a site id that no site has. */
const NO_SITE = "zzzzzzzzzzzz";

/** The layout of an install whose public addresses end in `page`. */
const PAGE = { kind: "hostname", public_word: "page" } as const;

/** The layout of an install whose public addresses end in `site`. */
const SITE = { kind: "hostname", public_word: "site" } as const;

/** The layout of an install that keeps its sites at paths on two hosts. */
const PATHS = { kind: "path", sites_host: "sites.example.net", private_host: "private.example.net" } as const;

/** The benches a test opened, closed after it. */
const OPEN: McpBench[] = [];

interface Site {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly access: string;
  readonly state: string;
  readonly live_version: number;
  readonly created?: boolean;
  readonly addresses: { readonly site: string; readonly public: string | null };
}

async function open(env?: Readonly<Record<string, string | undefined>>, layout?: Parameters<typeof openMcp>[2]): Promise<McpBench> {
  const bench = await openMcp(folderOf("home", {}), env, layout);
  OPEN.push(bench);

  return bench;
}

function siteOf(answer: Answer): Site {
  if (answer.error) throw new Error(`the call was refused: ${answer.text}`);

  return answer.data.site as Site;
}

/** A bench with one published site. */
async function withSite(): Promise<{ readonly bench: McpBench; readonly site: Site }> {
  const bench = await open();
  const site = siteOf(await bench.call("publish_site", { path: folderOf("report", { "index.html": "<title>Report</title>" }) }));
  bench.sent.length = 0;

  return { bench, site };
}

function codeOf(answer: Answer): unknown {
  return (answer.data.error as { code?: string } | undefined)?.code;
}

afterEach(async () => {
  for (const bench of OPEN.splice(0)) await bench.close();

  cleanUp();
});

describe("the MCP server", () => {
  test("the listing holds every one of core's tools with a schema, says something of every argument, and stays within its budget: one schema that cannot be listed takes the whole listing down, and an agent pays for every byte of it", async () => {
    const bench = await open();
    const { tools } = await bench.client.listTools();
    const undescribed = tools.flatMap((tool) =>
      Object.entries(tool.inputSchema.properties ?? {})
        .filter(([, property]) => typeof (property as { description?: unknown }).description !== "string")
        .map(([key]) => `${tool.name}.${key}`),
    );
    const listing = bench.written.find((line) => line.includes('"tools":[')) ?? "";

    expect(tools.map((tool) => tool.name)).toEqual(Object.keys(TOOL_INPUTS));
    expect(
      tools.filter((tool) => tool.inputSchema.type !== "object" || Object.keys(tool.inputSchema.properties ?? {}).length === 0).map((tool) => tool.name),
    ).toEqual([]);
    expect(undescribed).toEqual([]);
    expect(tools.filter((tool) => tool.inputSchema.additionalProperties !== false).map((tool) => tool.name)).toEqual([]);
    expect(Buffer.byteLength(listing)).toBeGreaterThan(0);
    expect(Buffer.byteLength(listing)).toBeLessThan(LISTING_BUDGET);
  });

  // Drift: a wait told in a tool's answer reads as an error to the agent, or breaks the answer's shape; one told nowhere leaves whoever runs the server no trace of why a call took seconds.
  test.each([
    ["a file that is sent again", () => new Response("<html>bad gateway</html>", { status: 502 }), "index.html", "the install did not take index.html: sending it again in 2 s, 2 of 4"],
    ["a file named after the token that is sent again", () => new Response("<html>bad gateway</html>", { status: 502 }), ".txt", "the install did not take [token].txt: sending it again in 2 s, 2 of 4"],
    ["a rest the install asks for", () => Response.json({ error: { code: "too_many_requests", message: "no" } }, { status: 429, headers: { "Retry-After": "3" } }), "index.html", "the install asks for a pause: going on in 3 s"],
  ])("%s during a publish is one line in the server's log, and the tool answers as a publish that met nothing", async (_name, fault, failing, line) => {
    const bench = await open();
    const folder = folderOf("report", { "index.html": "<title>Report</title>", [`${bench.install.tokens.admin}.txt`]: "x" });
    const plain = await bench.call("publish_site", { path: folder });
    let met = false;
    bench.hook = (request) => {
      if (met || request.method !== "PUT" || !request.url.includes(failing)) return undefined;

      met = true;

      return fault();
    };
    using _half = spyOn(Math, "random").mockReturnValue(0.5);

    const waited = await bench.call("publish_site", { path: folder });

    expect([waited.error, waited.text.split("\n").length, Object.keys(waited.data)]).toEqual([false, plain.text.split("\n").length, Object.keys(plain.data)]);
    expect([bench.logged, bench.written.some((written) => written.includes(line))]).toEqual([[line], false]);
  });

  test("a publish without site makes a new private site, and with the label it answered updates that site: an agent that cannot tell the two apart makes a new site on every change", async () => {
    const bench = await open();
    const folder = folderOf("report", { "index.html": "<title>Report</title>", ".env": "SECRET=1", "node_modules/pkg/index.js": "x", "notes/a.html": "a" });

    const made = await bench.call("publish_site", { path: folder });
    const first = siteOf(made);
    const updated = await bench.call("publish_site", { path: folder, site: first.label });
    const second = siteOf(updated);

    expect({ created: first.created, access: first.access, version: first.live_version }).toEqual({ created: true, access: "private", version: 1 });
    expect({ created: second.created, label: second.label, version: second.live_version }).toEqual({ created: false, label: first.label, version: 2 });
    expect(made.text.split("\n")).toEqual([
      `read ${folder}`,
      "uploaded 2 files, 22 B (2 skipped as hidden or node_modules)",
      `made  ${first.label}  private`,
      first.url,
    ]);
    expect(made.data.path).toBe(folder);
    expect((await bench.install.keys()).filter((key) => key.includes(".env") || key.includes("node_modules"))).toEqual([]);
    expect(await answered(bench.install.routes.sites.$get()).then((listed) => (listed.body.sites as unknown[]).length)).toBe(1);
  });

  test("a relative path is read from the server's working directory and answered as the absolute path: an agent told nothing cannot know which folder went up", async () => {
    const bench = await open();
    const home = process.cwd();
    // The working directory moves to the scratch folder: on Windows that folder may be on another drive, and no relative path crosses drives.
    process.chdir(dirname(folderOf("pages", { "one-page.html": "<title>One page</title>" })));
    const page = join(process.cwd(), "pages", "one-page.html");
    const made = await bench.call("publish_site", { path: "./pages/one-page.html" }).finally(() => process.chdir(home));

    expect(made.data.path).toBe(page);
    expect(made.text.split("\n")[0]).toBe(`read ${page}`);
    expect(siteOf(made).label.startsWith("one-page--")).toBe(true);
  });

  test("publish_site onto a site leaves a title update_site set, and a null title goes back to the page's own: an agent that republishes must not undo the owner's title", async () => {
    const { bench, site } = await withSite();
    const path = folderOf("report", { "index.html": "<title>Second</title>" });
    const titles: unknown[] = [];

    for (const [tool, input] of [["update_site", { title: "Q3 sales" }], ["publish_site", { path }], ["publish_site", { path, title: null }]] as const) {
      titles.push((siteOf(await bench.call(tool, { site: site.label, ...input })) as Site & { title: string }).title);
    }

    expect(titles).toEqual(["Q3 sales", "Q3 sales", "Second"]);
  });

  test("a name renames a site through update_site and through publish_site onto it, and the label it had still names it: an agent keeps the label of its first publish", async () => {
    const { bench, site } = await withSite();
    const path = folderOf("report", { "index.html": "<title>Second</title>" });
    const renamed = siteOf(await bench.call("update_site", { site: site.label, name: "q3-report" }));
    const again = siteOf(await bench.call("publish_site", { path, site: site.label, name: "notes" }));

    expect([renamed.label, renamed.addresses.site.includes(renamed.label), again.label, again.live_version]).toEqual([`q3-report--${site.id}`, true, `notes--${site.id}`, 2]);
  });

  test("each tool about a site does what its command does and answers the site: a tool that drifts from its command is a second rule book", async () => {
    const { bench, site } = await withSite();
    await bench.call("publish_site", { path: folderOf("report", { "index.html": "<title>Second</title>" }), site: site.label });

    const shown = await bench.call("get_site", { site: site.id });
    const unlisted = await bench.call("update_site", { site: site.label, access: "unlisted", title: "Q3 sales", expires: "7d" });
    const rolled = await bench.call("rollback_site", { site: site.addresses.site });
    const listed = await bench.call("list_sites");
    const trashed = await bench.call("delete_site", { site: site.label });
    const trash = await bench.call("list_sites", { trash: true });
    const restored = await bench.call("restore_site", { site: site.label });

    expect(shown.text.split("\n").slice(0, 2)).toEqual([site.label, site.url]);
    expect({ access: siteOf(unlisted).access, lines: unlisted.text.split("\n") }).toEqual({
      access: "unlisted",
      lines: [`unlisted  ${site.label}`, siteOf(unlisted).url, `address changed: ${site.url} is now ${siteOf(unlisted).url}`],
    });
    expect({ version: siteOf(rolled).live_version, lines: rolled.text.split("\n") }).toEqual({
      version: 1,
      lines: [`rolled back  ${site.label}  version 1 is live`, siteOf(rolled).url],
    });
    expect((listed.data.sites as Site[]).map((one) => one.label)).toEqual([site.label]);
    expect({ state: siteOf(trashed).state, last: trashed.text.split("\n").at(-1) }).toEqual({
      state: "trash",
      last: `to take it back: poplin restore ${site.label}`,
    });
    expect((trash.data.sites as Site[]).map((one) => one.label)).toEqual([site.label]);
    expect({ state: siteOf(restored).state, access: siteOf(restored).access }).toEqual({ state: "live", access: "unlisted" });
  });

  // Drift: a tool words a failed call as its command does. An agent told `not_json` and to check the address cannot tell the user that the install itself said why it does not start.
  test("an install that cannot start is quoted to the agent: the tool error carries its sentence", async () => {
    const bench = await open();
    const sentence = "This install's database was made by another build of poplin, so its records are not the ones this build reads. Deploy the build that made it, or delete the database and poplin makes it anew.";
    bench.hook = () => new Response(sentence, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });

    const answer = await bench.call("list_sites");

    expect([answer.error, answer.text]).toEqual([true, `not_json: the answer is plain text, status 503: ${sentence}`]);
  });

  // Drift: a tool reads a site as its command does. Only the install knows how its addresses are laid out; a tool that guessed would update or delete the site of another public name, or of another install.
  test.each([
    [PAGE, "https://LABEL-p-poplin.example.com/", ["GET /api/sites/LABEL"]],
    [PAGE, "https://LABEL-u-poplin.example.com/", ["GET /api/sites/LABEL"]],
    [PAGE, "https://notes-page.example.com/", ["GET /api/whoami", "GET /api/sites/notes"]],
    [SITE, "https://notes-site.example.com/guide", ["GET /api/whoami", "GET /api/sites/notes"]],
    [SITE, "ID", ["GET /api/sites/ID"]],
    [SITE, "LABEL", ["GET /api/sites/LABEL"]],
    [SITE, "notes", ["GET /api/sites/notes"]],
    [PATHS, "https://private.example.net/LABEL/", ["GET /api/whoami", "GET /api/sites/LABEL"]],
    [PATHS, "https://sites.example.net/notes/guide", ["GET /api/whoami", "GET /api/sites/notes"]],
    [PAGE, "https://notes-site.example.com/", ["GET /api/whoami"]],
    [SITE, "https://notes-page.example.com/", ["GET /api/whoami"]],
    [PAGE, "https://notes-page.example.org/", []],
    [PAGE, "https://sites.example.net/LABEL/", ["GET /api/whoami"]],
    [PATHS, "https://sites.example.org/LABEL/", ["GET /api/whoami"]],
    [PATHS, "https://private.example.net/notes/", ["GET /api/whoami"]],
  ] as const)("on an install laid out as %j, the site %s is asked for as the command asks: %j", async (layout, form, requests) => {
    const bench = await open(undefined, layout);
    const folder = folderOf("report", { "index.html": "<title>Report</title>" });
    const site = siteOf(await bench.call("publish_site", { path: folder, access: "public", public_name: "notes" }));
    const typed = form.replace("LABEL", site.label).replace("ID", site.id);
    const expected = requests.map((request) => request.replace("LABEL", site.label).replace("ID", site.id));
    bench.sent.length = 0;

    const shown = await bench.call("get_site", { site: typed });
    const asked = [...bench.sent];
    const updated = await bench.call("publish_site", { path: folder, site: typed });
    const deleted = await bench.call("delete_site", { site: typed, no_trash: true });
    const left = ((await answered(bench.install.routes.sites.$get())).body.sites as unknown[]).length;

    if (expected.at(-1)?.startsWith("GET /api/sites/") === true) {
      expect([asked, siteOf(shown).label, siteOf(updated).live_version, deleted.error, left]).toEqual([expected, site.label, 2, false, 0]);

      return;
    }

    expect([asked, codeOf(shown), codeOf(updated), codeOf(deleted), left]).toEqual([expected, "not_found", "not_found", "not_found", 1]);
  });

  test("duplicate_site answers a new private site under its own label and leaves the original as it was: an agent that reads the copy as the original would change the wrong one", async () => {
    const { bench, site } = await withSite();
    await bench.call("update_site", { site: site.label, access: "unlisted" });

    const copied = await bench.call("duplicate_site", { site: site.label, name: "report-draft" });
    const copy = siteOf(copied);
    const original = siteOf(await bench.call("get_site", { site: site.label }));

    expect(copied.text.split("\n")).toEqual([`copied  ${copy.label}  private  1 file`, copy.url]);
    expect({ sameId: copy.id === site.id, label: copy.label.slice(0, -12), access: copy.access, created: copy.created }).toEqual({ sameId: false, label: "report-draft--", access: "private", created: true });
    expect({ id: original.id, access: original.access, live: original.live_version }).toEqual({ id: site.id, access: "unlisted", live: 1 });
    expect(codeOf(await bench.call("duplicate_site", { site: site.label, name: "Not A Name" }))).toBe("bad_name");
  });

  // Drift: the tool runs the command's flow; a tool with a loop of its own would leave a half copy pending when a call of it fails.
  test("duplicate_site gives a copy up when a later call of it fails: an agent that tries again must not find the install full of half copies", async () => {
    const bench = await open();
    const pages = { "index.html": "<title>Report</title>", ...Object.fromEntries(Array.from({ length: 129 }, (_page, at) => [`pages/${at}.html`, "a"])) };
    const site = siteOf(await bench.call("publish_site", { path: folderOf("report", pages) }));
    bench.sent.length = 0;
    bench.hook = (request) => (bench.sent.length > 1 && request.url.endsWith("/duplicate") ? new Response("{}", { status: 500, headers: { "Content-Type": "application/json" } }) : undefined);

    const failed = await bench.call("duplicate_site", { site: site.label });
    const uploads = await bench.install.database.listUploads({ before: Number.MAX_SAFE_INTEGER, limit: 10 });

    expect([failed.error, bench.sent.at(-1)?.slice(0, 20), uploads.uploads.filter((upload) => upload.plan.kind === "duplicate").map((upload) => upload.state)]).toEqual([true, "DELETE /api/uploads/", ["abandoned"]]);
  });

  test("new_link and delete_site with no_trash say what was lost, and nothing less than their own argument asks for either: an agent must be able to tell the user what is gone", async () => {
    const { bench, site } = await withSite();

    const linked = await bench.call("new_link", { site: site.label });
    const moved = siteOf(linked);
    const old = await bench.call("get_site", { site: site.label });
    const kept = await bench.call("delete_site", { site: moved.label, no_trash: false });
    await bench.call("restore_site", { site: moved.label });
    const gone = await bench.call("delete_site", { site: moved.label, no_trash: true });
    const after = await bench.call("get_site", { site: moved.label });

    expect(linked.text.split("\n")).toEqual([
      `new link  ${moved.label}`,
      moved.url,
      `the old label ${site.label} and its address ${site.addresses.site} stopped working`,
    ]);
    expect(moved.id).not.toBe(site.id);
    expect(codeOf(old)).toBe("not_found");
    expect(siteOf(kept).state).toBe("trash");
    expect(gone.text.split("\n")).toEqual([
      `deleted for good  ${moved.label}`,
      "gone: 1 file in 1 kept version; nothing can restore them",
      `stopped working: ${moved.addresses.site}`,
    ]);
    expect({ site: gone.data.site, before: (gone.data.before as Site).label }).toEqual({ site: null, before: moved.label });
    expect(codeOf(after)).toBe("not_found");
  });

  // Drift: a tool and the command send a publish through one function; a tool that planned its own way would publish to an install without a domain what the command refuses.
  test("publish_site to an install without a domain refuses a page that links from the root, as the command does, before anything is sent", async () => {
    const bench = await open(undefined, PATHS);
    const path = folderOf("notes", { "index.html": '<img srcset="logo.png 1x, /logo@2x.png 2x">' });

    const answer = await bench.call("publish_site", { path });

    expect([answer.error, codeOf(answer), answer.data.error, bench.sent, await bench.install.keys()]).toEqual([
      true,
      "root_links",
      {
        code: "root_links",
        message: 'this install has no domain, so a link that starts with "/" would not open',
        about: "/logo@2x.png in index.html",
        hint: "nothing was sent; write the link from its own page, as css/site.css or ../css/site.css",
      },
      ["GET /api/whoami"],
      [],
    ]);
  });

  test.each([
    ["a site no install has", "get_site", { site: NO_SITE }, "not_found"],
    ["an update of a site in the trash", "update_site", { site: "TRASHED", access: "unlisted" }, "in_trash"],
    ["a public name another site holds", "update_site", { site: "SECOND", access: "public", public_name: "report" }, "name_taken"],
    ["a file past the install's limit", "publish_site", { path: "LARGE" }, "too_large"],
    ["an expiry that is no span or day", "update_site", { site: "SECOND", expires: "soon" }, "bad_argument"],
    ["a new name that breaks the rules", "update_site", { site: "SECOND", name: "Q3 Report" }, "bad_name"],
    ["a site that is a path", "delete_site", { site: "./report" }, "bad_argument"],
    ["an address that is no site's", "delete_site", { site: "https://poplin.example.com/" }, "bad_argument"],
    ["the address of a site of another install", "delete_site", { site: "ELSEWHERE" }, "not_found"],
    ["a site that is a Windows path", "delete_site", { site: "C:\\report" }, "bad_argument"],
    ["an empty path", "publish_site", { path: "" }, "bad_argument"],
    ["a name that breaks the rules", "publish_site", { path: "LARGE", name: "Q3 Report" }, "bad_name"],
    ["a folder that is not there", "publish_site", { path: "/no/such/folder" }, "unreadable"],
  ])("%s is answered as a tool error with its code, and changes nothing: an agent acts on the code", async (_name, tool, asked, code) => {
    const { bench, site } = await withSite();
    await bench.call("update_site", { site: site.label, access: "public" });
    const second = siteOf(await bench.call("publish_site", { path: folderOf("second", { "index.html": "<title>Second</title>" }) }));
    const trashed = siteOf(await bench.call("publish_site", { path: folderOf("trashed", { "index.html": "<title>Trashed</title>" }) }));
    await bench.call("delete_site", { site: trashed.label });
    const large = folderOf("large", { "index.html": "x".repeat(LIMITS.fileBytes + 1) });
    const stands: Readonly<Record<string, string>> = { TRASHED: trashed.label, SECOND: second.label, LARGE: large, ELSEWHERE: `https://${second.label}-p-poplin.example.org/` };
    const args = Object.fromEntries(Object.entries(asked).map(([key, value]) => [key, typeof value === "string" ? (stands[value] ?? value) : value]));
    const before = [
      (await answered(bench.install.routes.sites.$get())).body,
      (await answered(bench.install.routes.sites.$get({ query: { trash: "true" } }))).body,
      await bench.install.keys(),
    ];

    const answer = await bench.call(tool, args);

    expect({ error: answer.error, code: codeOf(answer), starts: answer.text.startsWith(`${code}: `) }).toEqual({ error: true, code, starts: true });
    expect([
      (await answered(bench.install.routes.sites.$get())).body,
      (await answered(bench.install.routes.sites.$get({ query: { trash: "true" } }))).body,
      await bench.install.keys(),
    ]).toEqual(before);
  });

  test.each([
    [
      "an argument of the wrong type",
      "delete_site",
      { site: "report--k3f9x2ab71qz", no_trash: "yes" },
      'no_trash: Invalid type: Expected boolean but received "yes"',
    ],
    ["an argument no tool takes", "get_site", { site: "report--k3f9x2ab71qz", force: true }, "force"],
    ["a missing argument", "publish_site", {}, "path"],
    ["an access that is none of the three", "update_site", { site: "report--k3f9x2ab71qz", access: "everyone" }, "access"],
    [
      "a title with a line break, a rule the listing cannot state",
      "update_site",
      { site: "report--k3f9x2ab71qz", title: "Q3\nsales" },
      "title: a title holds no control character and no line break",
    ],
    [
      "a title with a line break on a publish",
      "publish_site",
      { path: "./report", title: "Q3\nsales" },
      "title: a title holds no control character and no line break",
    ],
  ])(
    "%s is refused by core's schema with the table's code before anything is sent: a call the schema lets through reaches the install",
    async (_name, tool, args, names) => {
      const bench = await open();

      const answer = await bench.call(tool, args);

      expect({
        error: answer.error,
        code: codeOf(answer),
        sentence: answer.text.startsWith("bad_argument: an argument is missing, unknown, or of the wrong form: "),
        names: answer.text.includes(names),
      }).toEqual({ error: true, code: "bad_argument", sentence: true, names: true });
      expect(bench.sent).toEqual([]);
    },
  );

  test.each([
    ["no login", {}, "no_login", "not logged in", "run `poplin login --server <address>` on this computer"],
    ["half a login", { POPLIN_SERVER: ORIGIN }, "bad_login", "the login cannot be used", "POPLIN_TOKEN"],
  ])(
    "with %s the server starts, lists its tools, and answers every call with how to log in: a server that exits at start breaks the agent's app with no word why",
    async (_name, env, code, sentence, fix) => {
      const bench = await open(env);
      const { tools } = await bench.client.listTools();

      const answers = [
        await bench.call("list_sites"),
        await bench.call("publish_site", { path: folderOf("report", { "index.html": "<title>Report</title>" }) }),
      ];

      expect(tools).toHaveLength(9);
      expect(
        answers.map((answer) => ({
          error: answer.error,
          code: codeOf(answer),
          sentence: answer.text.includes(sentence),
          names: answer.text.includes(fix),
        })),
      ).toEqual([
        { error: true, code, sentence: true, names: true },
        { error: true, code, sentence: true, names: true },
      ]);
      expect(bench.sent).toEqual([]);
      expect(bench.logged).toHaveLength(1);
    },
  );

  // Drift: an agent that could start an update would replace the code of the install it publishes to. No tool is one, and no tool's call goes near that route.
  test("no tool starts an update: each one, called so that it reaches the install, asks only for sites", async () => {
    const { bench, site } = await withSite();
    const path = folderOf("again", { "index.html": "<title>Again</title>" });
    // A tool the server gains does not compile until it is called here.
    const inputs: Readonly<Record<keyof typeof TOOL_INPUTS, Record<string, unknown>>> = {
      get_site: { site: site.id },
      list_sites: {},
      update_site: { site: site.id, title: "Again" },
      publish_site: { path, site: site.id },
      rollback_site: { site: site.id },
      duplicate_site: { site: site.id },
      new_link: { site: site.id },
      delete_site: { site: site.id },
      restore_site: { site: site.id },
    };
    const silent: string[] = [];
    for (const [tool, input] of Object.entries(inputs)) {
      const before = bench.sent.length;
      await bench.call(tool, input);
      if (bench.sent.length === before) silent.push(tool);
    }

    const { update } = hc<Api>(ORIGIN).api;
    const paths: readonly string[] = [update.$path()];

    expect(silent).toEqual([]);
    expect(bench.sent.filter((line) => paths.some((path) => line.includes(path)))).toEqual([]);
    expect(bench.install.host.put).toEqual([]);
  });

  test("a token never leaves the server, whoever puts it into a message: the install's answer, the agent's own arguments, or a tool name", async () => {
    const { bench, site } = await withSite();
    const token = bench.install.tokens.admin;
    bench.hook = () => new Response(JSON.stringify({ error: { code: "internal", message: `failed for ${token}`, about: token } }), { status: 500 });

    const echoed = await bench.call("get_site", { site: site.label });
    bench.hook = undefined;
    const titled = await bench.call("update_site", { site: site.label, title: `the ${token}` });
    const mistyped = await bench.call("delete_site", { site: site.label, no_trash: token });
    const unknown = await bench.client.callTool({ name: token, arguments: {} }).catch((error: Error) => error.message);

    expect(echoed.text).toBe("internal: the install failed to do that: [token]\ntry again; poplin doctor reports on the install");
    expect((titled.data.site as { title: string }).title).toBe("the [token]");
    expect(mistyped.text).toBe(
      'bad_argument: an argument is missing, unknown, or of the wrong form: no_trash: Invalid type: Expected boolean but received "[token]"',
    );
    expect(JSON.stringify(unknown)).toContain("[token]");
    expect(bench.written.join("\n")).not.toContain(token);
  });
});
