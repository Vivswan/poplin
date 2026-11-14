import { describe, expect, test } from "bun:test";

import { COMMANDS } from "../../src/commands/command-table";
import { parseCommand } from "../../src/commands/parse-command";
import { words } from "./support/command-line";

const ID = "k3f9x2ab71qz";
const LABEL = `report--${ID}`;
const SECOND_LABEL = "report--w8t1c5n0ze4u";
const REPORT = { kind: "site", name: "report", id: ID };
const SECOND = { kind: "site", name: "report", id: "w8t1c5n0ze4u" };
const PLAIN = { json: false };
const SWAPPED = misspelled("list");
const CREATE = { kind: "publish", target: { kind: "create" }, settings: {}, dryRun: false, ...PLAIN };
const SEVEN_DAYS = { kind: "span", span: { count: 7, unit: "d" } };
const EXPIRY_FORMS = "a span is a count of s, m, h, or d: 7d. A date is 2026-12-01";
const NOW = Date.UTC(2026, 10, 1);
const KINDS = new Set<string>([...COMMANDS.map((spec) => spec.name), "version", "usage-error"]);

type Row = readonly [line: string, expected: object];

/** The misspelling of the published example. It is built, not written, because the repository's spell check reads test strings too. */
function misspelled(word: string): string {
  return word.replace("is", "si");
}

function refusal(message: string, hint?: string): object {
  return hint === undefined ? { kind: "usage-error", message } : { kind: "usage-error", message, hint };
}

describe("parseCommand", () => {
  // Drift: the published command reference shows these lines; one that stops parsing to its request makes the reference lie to whoever copies it.
  const documented: readonly Row[] = [
    ["poplin ./report", { ...CREATE, path: "./report" }],
    ["poplin ./report.html", { ...CREATE, path: "./report.html" }],
    ["poplin publish ./report", { ...CREATE, path: "./report" }],
    ["poplin ./report --name q3-sales", { ...CREATE, path: "./report", target: { kind: "create", name: "q3-sales" } }],
    [`poplin ./report --site ${LABEL}`, { ...CREATE, path: "./report", target: { kind: "update", site: REPORT } }],
    ["poplin ./report --site report", { ...CREATE, path: "./report", target: { kind: "update", site: { kind: "public-name", name: "report" } } }],
    ["poplin ./report --site docs", { ...CREATE, path: "./report", target: { kind: "update", site: { kind: "public-name", name: "docs" } } }],
    ["poplin ./demo --unlisted --expires 7d", { ...CREATE, path: "./demo", settings: { access: "unlisted", expires: SEVEN_DAYS } }],
    ["poplin ./report --dry-run", { ...CREATE, path: "./report", dryRun: true }],
    [`poplin set ${LABEL} --unlisted`, { kind: "set", site: REPORT, settings: { access: "unlisted" }, ...PLAIN }],
    [`poplin set ${LABEL} --public`, { kind: "set", site: REPORT, settings: { access: "public" }, ...PLAIN }],
    [`poplin set --public ${LABEL}`, { kind: "set", site: REPORT, settings: { access: "public" }, ...PLAIN }],
    [`poplin set ${SECOND_LABEL} --public`, { kind: "set", site: SECOND, settings: { access: "public" }, ...PLAIN }],
    [`poplin set ${SECOND_LABEL} --public --public-name docs`, { kind: "set", site: SECOND, settings: { access: "public", publicName: "docs" }, ...PLAIN }],
    [`poplin set ${LABEL} --name q3-report`, { kind: "set", site: REPORT, settings: { name: "q3-report" }, ...PLAIN }],
    [`poplin set ${LABEL} --title "Q3 sales"`, { kind: "set", site: REPORT, settings: { title: "Q3 sales" }, ...PLAIN }],
    [`poplin set ${LABEL} --title ""`, { kind: "set", site: REPORT, settings: { title: null }, ...PLAIN }],
    [`poplin set ${LABEL} --search-engines on`, { kind: "set", site: REPORT, settings: { searchEngines: true }, ...PLAIN }],
    [`poplin set ${LABEL} --embeddable off`, { kind: "set", site: REPORT, settings: { embeddable: false }, ...PLAIN }],
    [`poplin set ${LABEL} --expires 2026-12-01`, { kind: "set", site: REPORT, settings: { expires: { kind: "date", date: "2026-12-01" } }, ...PLAIN }],
    [`poplin set ${LABEL} --expires never`, { kind: "set", site: REPORT, settings: { expires: { kind: "never" } }, ...PLAIN }],
    [`poplin show ${LABEL}`, { kind: "show", site: REPORT, ...PLAIN }],
    [`poplin show ${ID}`, { kind: "show", site: { kind: "id", id: ID }, ...PLAIN }],
    [`poplin rollback ${LABEL}`, { kind: "rollback", site: REPORT, ...PLAIN }],
    [`poplin rollback ${LABEL} --to 4`, { kind: "rollback", site: REPORT, to: 4, ...PLAIN }],
    [`poplin new-link ${LABEL}`, { kind: "new-link", site: REPORT, ...PLAIN }],
    [`poplin duplicate ${LABEL}`, { kind: "duplicate", site: REPORT, ...PLAIN }],
    [`poplin duplicate ${LABEL} --name report-draft`, { kind: "duplicate", site: REPORT, name: "report-draft", ...PLAIN }],
    [`poplin delete ${LABEL}`, { kind: "delete", site: REPORT, forever: false, ...PLAIN }],
    ["poplin delete report", { kind: "delete", site: { kind: "public-name", name: "report" }, forever: false, ...PLAIN }],
    [`poplin delete ${LABEL} --forever`, { kind: "delete", site: REPORT, forever: true, ...PLAIN }],
    [`poplin restore ${LABEL}`, { kind: "restore", site: REPORT, ...PLAIN }],
    ["poplin list", { kind: "list", trash: false, ...PLAIN }],
    ["poplin list --trash", { kind: "list", trash: true, ...PLAIN }],
    ["poplin login", { kind: "login", publisher: false, browser: true, ...PLAIN }],
    ["poplin login --publisher", { kind: "login", publisher: true, browser: true, ...PLAIN }],
    ["poplin login --publisher --name ci-runner --no-browser", { kind: "login", publisher: true, browser: false, computer: "ci-runner", ...PLAIN }],
    ["poplin logout", { kind: "logout", ...PLAIN }],
    ["poplin whoami", { kind: "whoami", ...PLAIN }],
    ["poplin doctor", { kind: "doctor", ...PLAIN }],
    ["poplin export", { kind: "export", allVersions: false, overwrite: false, ...PLAIN }],
    [`poplin export ${LABEL}`, { kind: "export", site: REPORT, allVersions: false, overwrite: false, ...PLAIN }],
    ["poplin export --all-versions --out b.zip --overwrite", { kind: "export", allVersions: true, out: "b.zip", overwrite: true, ...PLAIN }],
    ["poplin import backup.zip", { kind: "import", zip: "backup.zip", settings: false, logins: false, dryRun: false, ...PLAIN }],
    [`poplin import backup.zip --site ${LABEL} --settings --logins --dry-run`, { kind: "import", zip: "backup.zip", site: REPORT, settings: true, logins: true, dryRun: true, ...PLAIN }],
    ["poplin mcp", { kind: "mcp" }],
    ["poplin config", { kind: "config", action: { kind: "show-all" }, ...PLAIN }],
    ["poplin config versions_kept", { kind: "config", action: { kind: "show", key: "versions_kept" }, ...PLAIN }],
    ["poplin config versions_kept 10", { kind: "config", action: { kind: "change", key: "versions_kept", value: "10" }, ...PLAIN }],
    ["poplin config outside_pages allowed", { kind: "config", action: { kind: "change", key: "outside_pages", value: "allowed" }, ...PLAIN }],
    [
      "poplin config logins a@example.com,b@example.com",
      { kind: "config", action: { kind: "change", key: "logins", value: "a@example.com,b@example.com" }, ...PLAIN },
    ],
    ["poplin list --json", { kind: "list", trash: false, json: true }],
    ["poplin list --server poplin.example.com", { kind: "list", trash: false, json: false, server: "poplin.example.com" }],
    ["poplin --help", { kind: "help", asked: true }],
    ["poplin --version", { kind: "version" }],
  ];

  test.each(documented)("the documented line `%s` parses to its request", (line, expected) => {
    expect<unknown>(parseCommand(words(line), NOW)).toEqual(expected);
  });

  // Drift: a typo that became a publish would upload a folder nobody meant to share, and one that became another command would change a site.
  const bareForm: readonly Row[] = [
    [`poplin ${SWAPPED}`, refusal(`unknown command "${SWAPPED}"`, `Did you mean: poplin list? To publish a folder with that name: poplin ./${SWAPPED}`)],
    ["poplin report", refusal('unknown command "report"', "To publish a folder with that name: poplin ./report")],
    ["poplin report.html", refusal('unknown command "report.html"', "To publish a file with that name: poplin ./report.html")],
    ["poplin publissh ./report", refusal('unknown command "publissh"', "Did you mean: poplin publish? To publish a folder with that name: poplin ./publissh")],
    ["poplin rotate report", refusal('unknown command "rotate"', "To publish a folder with that name: poplin ./rotate")],
    [`poplin site delete ${LABEL}`, refusal('unknown command "site"', "To publish a folder with that name: poplin ./site")],
    ["poplin install doctor", refusal('unknown command "install"', "To publish a folder with that name: poplin ./install")],
    ["poplin ./report", { ...CREATE, path: "./report" }],
    ["poplin .", { ...CREATE, path: "." }],
    ["poplin ~/site", { ...CREATE, path: "~/site" }],
    ["poplin /srv/site", { ...CREATE, path: "/srv/site" }],
    ["poplin sites/report", { ...CREATE, path: "sites/report" }],
    ["poplin C:\\work\\report", { ...CREATE, path: "C:\\work\\report" }],
    ["poplin .\\report --dry-run", { ...CREATE, path: ".\\report", dryRun: true }],
    ["poplin \\\\server\\share\\report", { ...CREATE, path: "\\\\server\\share\\report" }],
    ["poplin C:report", { ...CREATE, path: "C:report" }],
    ["poplin .\\list", { ...CREATE, path: ".\\list" }],
    ["poplin list", { kind: "list", trash: false, ...PLAIN }],
    ["poplin publish report", { ...CREATE, path: "report" }],
    [`poplin ./${SWAPPED}`, { ...CREATE, path: `./${SWAPPED}` }],
  ];

  test.each(bareForm)("the first word of `%s` is a command, a path, or refused, never guessed", (line, expected) => {
    expect<unknown>(parseCommand(words(line), NOW)).toEqual(expected);
  });

  test("an unknown word with characters a shell or a terminal reads gets no line to copy", () => {
    expect<unknown>(parseCommand(["a;b\u001b[2J"])).toEqual(refusal('unknown command "a;b\\u001b[2J"', "poplin --help lists the commands"));
  });

  // Drift: each of these is a mistake a person makes at the keyboard; one that slips through runs a command they did not write.
  const refused: readonly Row[] = [
    [`poplin set ${LABEL} --unlistd`, refusal('unknown flag "--unlistd"', "did you mean --unlisted?")],
    [`poplin show ${LABEL} --unlisted`, refusal('unknown flag "--unlisted"', "poplin help show lists the flags")],
    ["poplin ./report --tittle x", refusal('unknown flag "--tittle"', "did you mean --title?")],
    ["poplin ./report --search on", refusal('unknown flag "--search"', "poplin help publish lists the flags")],
    ["poplin ./report --embed-from example.com", refusal('unknown flag "--embed-from"', "poplin help publish lists the flags")],
    ["poplin doctor --fix", refusal('unknown flag "--fix"', "poplin help doctor lists the flags")],
    ["poplin mcp --server poplin.example.com", refusal('unknown flag "--server"', "poplin help mcp lists the flags")],
    ["poplin mcp --json", refusal('unknown flag "--json"', "poplin help mcp lists the flags")],
    ["poplin list -h", refusal('unknown flag "-h"', "poplin help list lists the flags")],
    ["poplin --bogus value ./report", refusal('unknown flag "--bogus"', "poplin help <command> lists the flags")],
    ["poplin --jsno", refusal('unknown flag "--jsno"', "did you mean --json?")],
    ["poplin --json", refusal("--json needs a command or a path before or after it", "poplin --help lists the commands")],
    ["poplin --title list", refusal("--title needs a command or a path before or after it", "poplin --help lists the commands")],
    ["poplin migrate", refusal('unknown command "migrate"', "To publish a folder with that name: poplin ./migrate")],
    ["poplin list --trash --trash", refusal("--trash was given twice")],
    [`poplin set ${LABEL} --title a --title b`, refusal("--title was given twice")],
    [`poplin set ${LABEL} --title`, refusal("--title needs a value: --title <title>")],
    [
      `poplin set ${LABEL} --title --public`,
      refusal("--title needs a value: --title <title>", "for a value that starts with a dash, join the two with =: --title=<title>"),
    ],
    [`poplin set ${LABEL} --public=yes`, refusal("--public takes no value")],
    [`poplin set ${LABEL} --private --public`, refusal("--private and --public cannot go together: a site has one access")],
    ["poplin ./report --unlisted --public", refusal("--unlisted and --public cannot go together: a site has one access")],
    [`poplin set ${LABEL}`, refusal("nothing to change: poplin set needs at least one setting", "poplin help set lists them")],
    [
      `poplin set ${LABEL} --public-name docs`,
      refusal("--public-name gives a public site its public name, so it needs --public", "poplin set <site> --public --public-name <public name>"),
    ],
    [`poplin set ${LABEL} --search-engines yes`, refusal('--search-engines takes on or off, not "yes"')],
    [`poplin set ${LABEL} --embeddable ON`, refusal('--embeddable takes on or off, not "ON"')],
    [`poplin set ${LABEL} --expires 2026-02-30`, refusal('--expires takes a span, a date, or never, not "2026-02-30"', EXPIRY_FORMS)],
    [`poplin set ${LABEL} --expires 0d`, refusal('--expires takes a span, a date, or never, not "0d"', EXPIRY_FORMS)],
    [`poplin set ${LABEL} --expires 7w`, refusal('--expires takes a span, a date, or never, not "7w"', EXPIRY_FORMS)],
    [`poplin set ${LABEL} --expires 2020-01-01`, refusal("--expires 2020-01-01 is not ahead: that day has started", EXPIRY_FORMS)],
    [`poplin set ${LABEL} --expires 2026-11-01`, refusal("--expires 2026-11-01 is not ahead: that day has started", EXPIRY_FORMS)],
    ["poplin ./demo --expires 100000000000d", refusal("--expires 100000000000d is too far ahead", EXPIRY_FORMS)],
    ["poplin ./demo --expires 100000000d", refusal("--expires 100000000d is too far ahead", EXPIRY_FORMS)],
    ["poplin set", refusal("poplin set needs a site", "poplin set <site>")],
    [`poplin show ${LABEL} ${SECOND_LABEL}`, refusal(`too many arguments for poplin show: "${SECOND_LABEL}"`, "poplin show <site>")],
    ["poplin ./one ./two", refusal('too many arguments for poplin publish: "./two"', "poplin publish <path>")],
    ["poplin list extra", refusal('too many arguments for poplin list: "extra"', "poplin list")],
    ["poplin delete ./report", refusal('"./report" is a path. Give the site\'s label; poplin list shows it.')],
    ["poplin delete .\\report", refusal('".\\\\report" is a path. Give the site\'s label; poplin list shows it.')],
    [
      "poplin show Report",
      refusal(
        '<site> "Report" is not a site: a name holds lowercase letters, digits, and single dashes',
        "a site is its label report--k3f9x2ab71qz, its id k3f9x2ab71qz, or a public site's public name",
      ),
    ],
    [
      "poplin show report--k3f9",
      refusal(
        '<site> "report--k3f9" is not a site: the part after the two dashes is not an id of 12 lowercase letters and digits',
        "a site is its label report--k3f9x2ab71qz, its id k3f9x2ab71qz, or a public site's public name",
      ),
    ],
    ["poplin ./report --site ./other", refusal('"./other" is a path. Give the site\'s label; poplin list shows it.')],
    [
      `poplin ./report --site ${LABEL} --unlisted --public-name docs`,
      refusal("--public-name gives a public site its public name, so it needs --public", "poplin set <site> --public --public-name <public name>"),
    ],
    [`poplin set ${LABEL} --public --public-name Q3`, refusal('--public-name "Q3" is not a name: a name has at least 3 characters')],
    [`poplin set ${LABEL} --name Q3`, refusal('--name "Q3" is not a name: a name has at least 3 characters')],
    ["poplin ./report --name Q3", refusal('--name "Q3" is not a name: a name has at least 3 characters')],
    [`poplin rollback ${LABEL} --to 0`, refusal('--to takes a version number such as 4, not "0"', "poplin show <site> lists the versions")],
    [`poplin rollback ${LABEL} --to=-1`, refusal('--to takes a version number such as 4, not "-1"', "poplin show <site> lists the versions")],
    ["poplin config versions_kep", refusal('unknown setting "versions_kep"', "did you mean versions_kept?")],
    ["poplin config colour", refusal('unknown setting "colour"', "poplin config shows every setting")],
    ["poplin config versions_kept 0", refusal('"0" is not a value of versions_kept', "for example: poplin config versions_kept 3")],
    ["poplin config default_expires soon", refusal('"soon" is not a value of default_expires', "for example: poplin config default_expires never")],
    ["poplin config versions_kept --reset", refusal('unknown flag "--reset"', "poplin help config lists the flags")],
    ["poplin setup", refusal('unknown command "setup"', "To publish a folder with that name: poplin ./setup")],
    ["poplin list --server=", refusal("--server needs the address of an install")],
    ["poplin export --out=", refusal("--out needs the path of the zip to write", "poplin export --out backup.zip")],
    ["poplin import backup.zip --logins", refusal("--logins replaces the logins among the settings, so it needs --settings", "poplin import <zip> --settings --logins")],
    ["poplin import backup.zip --site ./report", refusal('"./report" is a path. Give the site\'s label; poplin list shows it.')],
    [`poplin help ${SWAPPED}`, refusal(`unknown command "${SWAPPED}"`, "Did you mean: poplin list?")],
    ["poplin help set show", refusal('too many arguments for poplin help: "show"', "poplin help [<command>]")],
  ];

  test.each(refused)("the mistake in `%s` is refused with what to type", (line, expected) => {
    expect<unknown>(parseCommand(words(line), NOW)).toEqual(expected);
  });

  test("flags mean the same before, between, and after the arguments, so a habit from another tool still works", () => {
    const expected = { ...CREATE, path: "./demo", settings: { access: "unlisted", expires: SEVEN_DAYS, title: "Demo" }, json: true };
    const orders = [
      "poplin ./demo --unlisted --expires 7d --title Demo --json",
      "poplin --unlisted --expires 7d --title Demo --json ./demo",
      "poplin --json --unlisted ./demo --title Demo --expires 7d",
      "poplin publish --expires=7d ./demo --title=Demo --json --unlisted",
      "poplin --title Demo publish --unlisted --json --expires 7d ./demo",
    ];

    expect<unknown>(orders.map((line) => parseCommand(words(line), NOW))).toEqual(orders.map(() => expected));
  });

  test("--name is the site's name wherever it is typed, a new site's or the new name of one that is updated, and --public-name alone is the public name", () => {
    const created = { ...CREATE, path: "./report", target: { kind: "create", name: "docs" }, settings: { access: "public" } };
    const renamed = { ...CREATE, path: "./report", target: { kind: "update", site: REPORT }, settings: { access: "public", name: "docs" } };
    const both = { ...CREATE, path: "./report", target: { kind: "create", name: "docs" }, settings: { access: "public", publicName: "manual" } };

    expect<unknown>([
      parseCommand(words("poplin ./report --public --name docs")),
      parseCommand(words(`poplin ./report --site ${LABEL} --public --name docs`)),
      parseCommand(words("poplin ./report --public --name docs --public-name manual")),
    ]).toEqual([created, renamed, both]);
  });

  test("after -- every word is an argument, so a title or a folder that starts with a dash can be typed", () => {
    expect<unknown>([
      parseCommand(["publish", "--unlisted", "--", "--help"]),
      parseCommand(["set", LABEL, "--title=--draft--"]),
      parseCommand(["--", "list"]),
    ]).toEqual([
      { ...CREATE, path: "--help", settings: { access: "unlisted" } },
      { kind: "set", site: REPORT, settings: { title: "--draft--" }, ...PLAIN },
      { kind: "list", trash: false, ...PLAIN },
    ]);
  });

  test("help is answered for the command that was named, whatever else is on the line, and never for a mistyped one", () => {
    const lines = [
      "poplin",
      "poplin help",
      "poplin help set",
      "poplin set --help",
      `poplin set ${LABEL} --bogus --help`,
      "poplin ./report --help",
      "poplin help help",
      "poplin list --version",
      `poplin set ${LABEL} --title --help`,
      "poplin list --server --version",
      `poplin ${SWAPPED} --help`,
    ];

    expect<unknown>(lines.map((line) => parseCommand(words(line), NOW))).toEqual([
      { kind: "help", asked: false },
      { kind: "help", asked: true },
      { kind: "help", topic: "set", asked: true },
      { kind: "help", topic: "set", asked: true },
      { kind: "help", topic: "set", asked: true },
      { kind: "help", topic: "publish", asked: true },
      { kind: "help", topic: "help", asked: true },
      { kind: "version" },
      { kind: "help", topic: "set", asked: true },
      { kind: "version" },
      refusal(`unknown command "${SWAPPED}"`, `Did you mean: poplin list? To publish a folder with that name: poplin ./${SWAPPED}`),
    ]);
  });

  test("every command of the table answers with its own kind, so no command is listed and then dropped by the parser", () => {
    const samples: Readonly<Record<string, string>> = { path: "./report", site: LABEL, zip: "backup.zip" };
    const extra: Readonly<Record<string, readonly string[]>> = { set: ["--private"] };

    const kinds = COMMANDS.map((spec) => {
      const required = spec.arguments.filter((argument) => argument.required).map((argument) => samples[argument.name] ?? "");

      return parseCommand([spec.name, ...required, ...(extra[spec.name] ?? [])]).kind;
    });

    expect(kinds).toEqual(COMMANDS.map((spec) => spec.name));
    expect(kinds.filter((kind) => !KINDS.has(kind))).toEqual([]);
  });
});
