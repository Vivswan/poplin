import { describe, expect, test } from "bun:test";

import { COMMANDS } from "../../../src/commands/command-table";
import { parseCommand } from "../../../src/commands/line/parse-command";
import { words } from "../support/command-line";

const ID = "k3f9x2ab71qz";
const LABEL = `report--${ID}`;
const SECOND_LABEL = "report--w8t1c5n0ze4u";
const REPORT = { kind: "site", name: "report", id: ID };
const SECOND = { kind: "site", name: "report", id: "w8t1c5n0ze4u" };
const PLAIN = { json: false };
const ADDRESS = `https://${LABEL}-p-poplin.example.com`;
const ADDRESSED = { ...REPORT, under: "example.com" };
const SITE_FORMS = "A site is a label (report--k3f9x2ab71qz), an id (k3f9x2ab71qz), a public name, or a URL.";
const SWAPPED = misspelled("list");
const CREATE = { kind: "publish", target: { kind: "create" }, settings: {}, dryRun: false, ...PLAIN };
const SEVEN_DAYS = { kind: "span", span: { count: 7, unit: "d" } };
const EXPIRY_FORMS = "Usage: --expires 7d (s, m, h, or d), 2026-12-01, or never";
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
    [`poplin set ${LABEL} --unlisted`, { kind: "set", site: REPORT, settings: { access: "unlisted" }, dryRun: false, ...PLAIN }],
    [`poplin set ${LABEL} --public`, { kind: "set", site: REPORT, settings: { access: "public" }, dryRun: false, ...PLAIN }],
    [`poplin set --public ${LABEL}`, { kind: "set", site: REPORT, settings: { access: "public" }, dryRun: false, ...PLAIN }],
    [`poplin set ${SECOND_LABEL} --public`, { kind: "set", site: SECOND, settings: { access: "public" }, dryRun: false, ...PLAIN }],
    [`poplin set ${SECOND_LABEL} --public --public-name docs`, { kind: "set", site: SECOND, settings: { access: "public", publicName: "docs" }, dryRun: false, ...PLAIN }],
    [`poplin set ${LABEL} --name q3-report`, { kind: "set", site: REPORT, settings: { name: "q3-report" }, dryRun: false, ...PLAIN }],
    [`poplin set ${LABEL} --title "Q3 sales"`, { kind: "set", site: REPORT, settings: { title: "Q3 sales" }, dryRun: false, ...PLAIN }],
    [`poplin set ${LABEL} --title ""`, { kind: "set", site: REPORT, settings: { title: null }, dryRun: false, ...PLAIN }],
    [`poplin set ${LABEL} --search-engines on`, { kind: "set", site: REPORT, settings: { searchEngines: true }, dryRun: false, ...PLAIN }],
    [`poplin set ${LABEL} --embeddable off`, { kind: "set", site: REPORT, settings: { embeddable: false }, dryRun: false, ...PLAIN }],
    [`poplin set ${LABEL} --expires 2026-12-01`, { kind: "set", site: REPORT, settings: { expires: { kind: "date", date: "2026-12-01" } }, dryRun: false, ...PLAIN }],
    [`poplin set ${LABEL} --expires never`, { kind: "set", site: REPORT, settings: { expires: { kind: "never" } }, dryRun: false, ...PLAIN }],
    [`poplin show ${LABEL}`, { kind: "show", site: REPORT, ...PLAIN }],
    [`poplin show ${ID}`, { kind: "show", site: { kind: "id", id: ID }, ...PLAIN }],
    [`poplin show ${ADDRESS}/page?x=1#top`, { kind: "show", site: ADDRESSED, ...PLAIN }],
    [`poplin show ${LABEL}-u-poplin.example.com/`, { kind: "show", site: ADDRESSED, ...PLAIN }],
    [`poplin show ${LABEL}-p-poplin`, { kind: "show", site: REPORT, ...PLAIN }],
    ["poplin delete https://docs-page.example.com/", { kind: "delete", site: { kind: "address", label: "docs-page", under: "example.com" }, noTrash: false, dryRun: false, ...PLAIN }],
    [`poplin ./report --site ${ADDRESS}`, { ...CREATE, path: "./report", target: { kind: "update", site: ADDRESSED } }],
    [`poplin export ${ADDRESS}`, { kind: "export", site: ADDRESSED, allVersions: false, overwrite: false, ...PLAIN }],
    [`poplin import backup.zip --site ${ADDRESS}`, { kind: "import", zip: "backup.zip", site: ADDRESSED, settings: false, logins: false, dryRun: false, ...PLAIN }],
    [`poplin rollback ${LABEL}`, { kind: "rollback", site: REPORT, dryRun: false, ...PLAIN }],
    [`poplin rollback ${LABEL} --to 4`, { kind: "rollback", site: REPORT, to: 4, dryRun: false, ...PLAIN }],
    [`poplin new-link ${LABEL}`, { kind: "new-link", site: REPORT, dryRun: false, ...PLAIN }],
    [`poplin duplicate ${LABEL}`, { kind: "duplicate", site: REPORT, dryRun: false, ...PLAIN }],
    [`poplin duplicate ${LABEL} --name report-draft`, { kind: "duplicate", site: REPORT, name: "report-draft", dryRun: false, ...PLAIN }],
    [`poplin delete ${LABEL}`, { kind: "delete", site: REPORT, noTrash: false, dryRun: false, ...PLAIN }],
    ["poplin delete report", { kind: "delete", site: { kind: "public-name", name: "report" }, noTrash: false, dryRun: false, ...PLAIN }],
    [`poplin delete ${LABEL} --no-trash`, { kind: "delete", site: REPORT, noTrash: true, dryRun: false, ...PLAIN }],
    [`poplin restore ${LABEL}`, { kind: "restore", site: REPORT, dryRun: false, ...PLAIN }],
    [`poplin set ${LABEL} --unlisted --dry-run`, { kind: "set", site: REPORT, settings: { access: "unlisted" }, dryRun: true, ...PLAIN }],
    [`poplin rollback ${LABEL} --to 4 --dry-run`, { kind: "rollback", site: REPORT, to: 4, dryRun: true, ...PLAIN }],
    [`poplin new-link ${LABEL} --dry-run`, { kind: "new-link", site: REPORT, dryRun: true, ...PLAIN }],
    [`poplin duplicate ${LABEL} --dry-run`, { kind: "duplicate", site: REPORT, dryRun: true, ...PLAIN }],
    [`poplin delete ${LABEL} --no-trash --dry-run`, { kind: "delete", site: REPORT, noTrash: true, dryRun: true, ...PLAIN }],
    [`poplin restore ${LABEL} --dry-run`, { kind: "restore", site: REPORT, dryRun: true, ...PLAIN }],
    ["poplin logout --dry-run", { kind: "logout", dryRun: true, ...PLAIN }],
    ["poplin config trash_days 9 --dry-run", { kind: "config", action: { kind: "change", key: "trash_days", value: "9", dryRun: true }, ...PLAIN }],
    ["poplin list", { kind: "list", trash: false, ...PLAIN }],
    ["poplin list --trash", { kind: "list", trash: true, ...PLAIN }],
    ["poplin login", { kind: "login", publisher: false, browser: true, ...PLAIN }],
    ["poplin login --publisher", { kind: "login", publisher: true, browser: true, ...PLAIN }],
    ["poplin login --publisher --machine ci-runner --no-browser", { kind: "login", publisher: true, browser: false, computer: "ci-runner", ...PLAIN }],
    ["poplin logout", { kind: "logout", dryRun: false, ...PLAIN }],
    ["poplin whoami", { kind: "whoami", ...PLAIN }],
    ["poplin doctor", { kind: "doctor", ...PLAIN }],
    ["poplin update", { kind: "update", action: { kind: "start" }, ...PLAIN }],
    ["poplin update --to 0.2.0", { kind: "update", action: { kind: "start", to: "0.2.0" }, ...PLAIN }],
    ["poplin update --dry-run --json", { kind: "update", action: { kind: "check" }, json: true }],
    ["poplin export", { kind: "export", allVersions: false, overwrite: false, ...PLAIN }],
    [`poplin export ${LABEL}`, { kind: "export", site: REPORT, allVersions: false, overwrite: false, ...PLAIN }],
    ["poplin export --all-versions --out b.zip --overwrite", { kind: "export", allVersions: true, out: "b.zip", overwrite: true, ...PLAIN }],
    ["poplin import backup.zip", { kind: "import", zip: "backup.zip", settings: false, logins: false, dryRun: false, ...PLAIN }],
    [`poplin import backup.zip --site ${LABEL} --settings --users --dry-run`, { kind: "import", zip: "backup.zip", site: REPORT, settings: true, logins: true, dryRun: true, ...PLAIN }],
    ["poplin mcp", { kind: "mcp" }],
    ["poplin config", { kind: "config", action: { kind: "show-all" }, ...PLAIN }],
    ["poplin config versions_kept", { kind: "config", action: { kind: "show", key: "versions_kept" }, ...PLAIN }],
    ["poplin config versions_kept 10", { kind: "config", action: { kind: "change", key: "versions_kept", value: "10", dryRun: false }, ...PLAIN }],
    ["poplin config outside_pages allowed", { kind: "config", action: { kind: "change", key: "outside_pages", value: "allowed", dryRun: false }, ...PLAIN }],
    [
      "poplin config logins a@example.com,b@example.com",
      { kind: "config", action: { kind: "change", key: "logins", value: "a@example.com,b@example.com", dryRun: false }, ...PLAIN },
    ],
    ["poplin list --json", { kind: "list", trash: false, json: true }],
    ["poplin list --server poplin.example.com", { kind: "list", trash: false, json: false, server: "poplin.example.com" }],
    ["poplin --help", { kind: "help", asked: true }],
    ["poplin --full-help", { kind: "help", asked: true, full: true }],
    ["poplin --help --full-help", { kind: "help", asked: true, full: true }],
    ["poplin --version", { kind: "version" }],
  ];

  test.each(documented)("the documented line `%s` parses to its request", (line, expected) => {
    expect<unknown>(parseCommand(words(line), NOW)).toEqual(expected);
  });

  // Drift: a typo that became a publish would upload a folder nobody meant to share, and one that became another command would change a site.
  const bareForm: readonly Row[] = [
    [`poplin ${SWAPPED}`, refusal(`Unknown command "${SWAPPED}"`, "Did you mean poplin list?")],
    ["poplin report", refusal('Unknown command "report"', "To publish a folder of that name: poplin ./report")],
    ["poplin report.html", refusal('Unknown command "report.html"', "To publish a file of that name: poplin ./report.html")],
    ["poplin publissh ./report", refusal('Unknown command "publissh"', "Did you mean poplin publish?")],
    ["poplin rotate report", refusal('Unknown command "rotate"', "To publish a folder of that name: poplin ./rotate")],
    [`poplin site delete ${LABEL}`, refusal('Unknown command "site"', "To publish a folder of that name: poplin ./site")],
    ["poplin instal doctor", refusal('Unknown command "instal"', "Did you mean poplin install?")],
    ["poplin install", { kind: "provider", command: "install", words: [] }],
    ["poplin install somewhere --no-such-flag --user you@example.com", { kind: "provider", command: "install", words: ["somewhere", "--no-such-flag", "--user", "you@example.com"] }],
    ["poplin --json install somewhere", { kind: "provider", command: "install", words: ["--json", "somewhere"] }],
    ["poplin install --help", { kind: "provider", command: "install", words: ["--help"] }],
    ["poplin help install", { kind: "provider", command: "install", words: ["--help"] }],
    ["poplin uninstall somewhere --dry-run --confirm=poplin.example.com", { kind: "provider", command: "uninstall", words: ["somewhere", "--dry-run", "--confirm=poplin.example.com"] }],
    ["poplin help uninstall", { kind: "provider", command: "uninstall", words: ["--help"] }],
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
    expect<unknown>(parseCommand(["a;b\u001b[2J"])).toEqual(refusal('Unknown command "a;b\\u001b[2J"', "See: poplin --help"));
  });

  // Drift: each of these is a mistake a person makes at the keyboard; one that slips through runs a command they did not write.
  const refused: readonly Row[] = [
    [`poplin set ${LABEL} --unlistd`, refusal('Unknown option --unlistd', "Did you mean --unlisted?")],
    [`poplin show ${LABEL} --unlisted`, refusal('Unknown option --unlisted', "See: poplin show --help")],
    ["poplin ./report --tittle x", refusal('Unknown option --tittle', "Did you mean --title?")],
    ["poplin ./report --search on", refusal('Unknown option --search', "See: poplin publish --help")],
    ["poplin ./report --embed-from example.com", refusal('Unknown option --embed-from', "See: poplin publish --help")],
    ["poplin doctor --fix", refusal('Unknown option --fix', "See: poplin doctor --help")],
    ["poplin mcp --server poplin.example.com", refusal('Unknown option --server', "See: poplin mcp --help")],
    ["poplin mcp --json", refusal('Unknown option --json', "See: poplin mcp --help")],
    ["poplin list -h", refusal('Unknown option -h', "See: poplin list --help")],
    ["poplin --bogus value ./report", refusal('Unknown option --bogus', "See: poplin <command> --help")],
    ["poplin --jsno", refusal('Unknown option --jsno', "Did you mean --json?")],
    ["poplin --json", refusal("--json requires a command or a path", "See: poplin --help")],
    ["poplin --title list", refusal("--title requires a command or a path", "See: poplin --help")],
    ["poplin migrate", refusal('Unknown command "migrate"', "To publish a folder of that name: poplin ./migrate")],
    ["poplin list --trash --trash", refusal("--trash was passed more than once")],
    [`poplin set ${LABEL} --title a --title b`, refusal("--title was passed more than once")],
    [`poplin set ${LABEL} --title`, refusal("--title requires a value: --title <title>")],
    [
      `poplin set ${LABEL} --title --public`,
      refusal("--title requires a value: --title <title>", "For a value starting with a dash: --title=<title>"),
    ],
    [`poplin set ${LABEL} --public=yes`, refusal("--public takes no value")],
    [`poplin set ${LABEL} --private --public`, refusal("--private and --public are mutually exclusive")],
    ["poplin ./report --unlisted --public", refusal("--unlisted and --public are mutually exclusive")],
    [`poplin set ${LABEL}`, refusal("poplin set requires at least one setting", "See: poplin set --help")],
    [
      `poplin set ${LABEL} --public-name docs`,
      refusal("--public-name requires --public", "Usage: poplin set <site> --public --public-name <public name>"),
    ],
    [`poplin set ${LABEL} --search-engines yes`, refusal('--search-engines requires on or off, got "yes"')],
    [`poplin set ${LABEL} --embeddable ON`, refusal('--embeddable requires on or off, got "ON"')],
    [`poplin set ${LABEL} --expires 2026-02-30`, refusal('--expires requires a duration, a date, or never, got "2026-02-30"', EXPIRY_FORMS)],
    [`poplin set ${LABEL} --expires 0d`, refusal('--expires requires a duration, a date, or never, got "0d"', EXPIRY_FORMS)],
    [`poplin set ${LABEL} --expires 7w`, refusal('--expires requires a duration, a date, or never, got "7w"', EXPIRY_FORMS)],
    [`poplin set ${LABEL} --expires 2020-01-01`, refusal("--expires 2020-01-01 is not a future date", EXPIRY_FORMS)],
    [`poplin set ${LABEL} --expires 2026-11-01`, refusal("--expires 2026-11-01 is not a future date", EXPIRY_FORMS)],
    ["poplin ./demo --expires 100000000000d", refusal("--expires 100000000000d is too long a duration", EXPIRY_FORMS)],
    ["poplin ./demo --expires 100000000d", refusal("--expires 100000000d is too long a duration", EXPIRY_FORMS)],
    ["poplin ./demo --expires 36501d", refusal("--expires 36501d is too long a duration", EXPIRY_FORMS)],
    ["poplin set", refusal("Missing argument <site>", "Usage: poplin set <site>")],
    [`poplin show ${LABEL} ${SECOND_LABEL}`, refusal(`Unexpected argument "${SECOND_LABEL}"`, "Usage: poplin show <site>")],
    ["poplin ./one ./two", refusal('Unexpected argument "./two"', "Usage: poplin publish <path>")],
    ["poplin list extra", refusal('Unexpected argument "extra"', "Usage: poplin list")],
    ["poplin delete ./report", refusal('"./report" is a path, not a site. See: poplin list')],
    ["poplin delete .\\report", refusal('".\\\\report" is a path, not a site. See: poplin list')],
    [
      "poplin show Report",
      refusal(
        'Invalid <site> "Report": only lowercase letters, digits, and single dashes are allowed',
        SITE_FORMS,
      ),
    ],
    [
      "poplin show report--k3f9",
      refusal(
        'Invalid <site> "report--k3f9": the part after -- is not an id of 12 lowercase letters and digits',
        SITE_FORMS,
      ),
    ],
    [
      "poplin show https://example.com/report.html",
      refusal('Invalid <site> "https://example.com/report.html": it is a URL, but not a site URL such as https://report--k3f9x2ab71qz-p-poplin.example.com', SITE_FORMS),
    ],
    [
      "poplin show <https://example.com/report.html>",
      refusal('Invalid <site> "<https://example.com/report.html>": it is a URL, but not a site URL such as https://report--k3f9x2ab71qz-p-poplin.example.com', SITE_FORMS),
    ],
    ["poplin show report.html", refusal('Invalid <site> "report.html": it is not a site URL such as report--k3f9x2ab71qz-p-poplin.example.com', SITE_FORMS)],
    ["poplin ./report --site ./other", refusal('"./other" is a path, not a site. See: poplin list')],
    [
      `poplin ./report --site ${LABEL} --unlisted --public-name docs`,
      refusal("--public-name requires --public", "Usage: poplin set <site> --public --public-name <public name>"),
    ],
    [`poplin set ${LABEL} --public --public-name Q3`, refusal('Invalid --public-name "Q3": the minimum is 3 characters')],
    [`poplin set ${LABEL} --name Q3`, refusal('Invalid --name "Q3": the minimum is 3 characters')],
    ["poplin ./report --name Q3", refusal('Invalid --name "Q3": the minimum is 3 characters')],
    [`poplin rollback ${LABEL} --to 0`, refusal('--to requires a version number such as 4, got "0"', "See: poplin show <site>")],
    [`poplin rollback ${LABEL} --to=-1`, refusal('--to requires a version number such as 4, got "-1"', "See: poplin show <site>")],
    ["poplin update --to latest", refusal("--to requires a version such as 0.2.0", "Usage: poplin update --to <version>")],
    ["poplin update --to v0.2.0", refusal("--to requires a version such as 0.2.0", "Usage: poplin update --to <version>")],
    ["poplin config --dry-run", refusal("--dry-run requires a <value>", "Usage: poplin config <key> <value> --dry-run")],
    ["poplin config trash_days --dry-run", refusal("--dry-run requires a <value>", "Usage: poplin config <key> <value> --dry-run")],
    ["poplin update --dry-run --to 0.2.0", refusal("--dry-run and --to are mutually exclusive", "Usage: poplin update --dry-run")],
    ["poplin config versions_kep", refusal('Unknown setting "versions_kep"', "Did you mean versions_kept?")],
    ["poplin config colour", refusal('Unknown setting "colour"', "See: poplin config")],
    ["poplin config versions_kept 0", refusal('Invalid value "0" for versions_kept', "Usage: poplin config versions_kept 3")],
    ["poplin config default_expires soon", refusal('Invalid value "soon" for default_expires', "Usage: poplin config default_expires never")],
    ["poplin config versions_kept --reset", refusal('Unknown option --reset', "See: poplin config --help")],
    ["poplin list --server=", refusal("--server requires an install URL")],
    ["poplin export --out=", refusal("--out requires a file path", "Usage: poplin export --out <file>")],
    ["poplin import backup.zip --users", refusal("--users requires --settings", "Usage: poplin import <zip> --settings --users")],
    ["poplin import backup.zip --site ./report", refusal('"./report" is a path, not a site. See: poplin list')],
    [`poplin help ${SWAPPED}`, refusal(`Unknown command "${SWAPPED}"`, "Did you mean poplin list?")],
    ["poplin help set show", refusal('Unexpected argument "show"', "Usage: poplin help [<command>]")],
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

  // Drift: a title the install refuses came back as "Invalid argument: title", exit 1, with no rule named, where every other flag is refused on this machine with exit 2.
  test.each([
    ["longer than a title may be", "x".repeat(201), "--title is 201 characters, the maximum is 200"],
    ["of two lines", "two\nlines", "--title has a line break or a control character"],
  ])("a title %s is refused before anything is sent, with the rule it breaks, on a publish and on a set alike", (_name, title, message) => {
    const refused = refusal(message, 'A title is one line of at most 200 characters. "" uses the page title.');

    expect<unknown>([parseCommand(["set", LABEL, "--title", title], NOW), parseCommand(["./report", "--title", title], NOW)]).toEqual([refused, refused]);
    expect(parseCommand(["set", LABEL, "--title", "x".repeat(200)], NOW)).toMatchObject({ kind: "set", settings: { title: "x".repeat(200) } });
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
      { kind: "set", site: REPORT, settings: { title: "--draft--" }, dryRun: false, ...PLAIN },
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
      refusal(`Unknown command "${SWAPPED}"`, "Did you mean poplin list?"),
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
