// The command table: every command, its arguments, and its flags. The parser accepts what it lists and the help prints what it lists, so the two cannot disagree.

/** The flag that asks for a command's help. */
export const HELP_FLAG = "--help";

/** The flag that asks for the version. */
export const VERSION_FLAG = "--version";

/** The two flags every command takes. */
const EVERYWHERE: readonly FlagSpec[] = [
  { name: HELP_FLAG, about: "show this help" },
  { name: VERSION_FLAG, about: "print the version" },
];

/** The argument that names one site. */
const SITE = { name: "site", about: "its label, id, public name, or address" };

/** The settings of a site, the same when it is published and when it is changed. */
const SITE_SETTINGS: readonly FlagSpec[] = [
  { name: "--private", about: "only you can open it" },
  { name: "--unlisted", about: "anyone who has the address can open it" },
  { name: "--public", about: "everyone can open it, at its public name" },
  { name: "--public-name", value: "<name>", about: "with --public: its public name, when not its name" },
  { name: "--title", value: "<title>", about: 'its title on your dashboard; "" is the page\'s own' },
  { name: "--search-engines", value: "on|off", about: "may search engines list it, if the install allows" },
  { name: "--embeddable", value: "on|off", about: "may other pages show it in a frame" },
  { name: "--expires", value: "<when>", about: "when it moves to the trash: 7d, 2026-12-01, never" },
];

/** The command the bare form `poplin <path>` runs. */
export const BARE_COMMAND = "publish";

/** A short session from the first publish to the trash, for the help of `poplin` itself. */
export const SESSION = [
  "poplin ./report",
  "poplin set report--k3f9x2ab71qz --unlisted",
  "poplin ./report --site report--k3f9x2ab71qz",
  "poplin rollback report--k3f9x2ab71qz",
  "poplin set report--k3f9x2ab71qz --public",
  "poplin ./report --site report",
  "poplin delete report",
];

/** Every command, in the order the help lists them. */
export const COMMANDS = [
  {
    name: "publish",
    group: "publish",
    about: "put a new site up, or update one with --site",
    arguments: [{ name: "path", about: "a folder with an index.html, or one HTML file", required: true }],
    flags: [
      { name: "--site", value: "<site>", about: "update it: its label, id, public name, or address" },
      { name: "--name", value: "<name>", about: "the site's name; with --site, its new name" },
      { name: "--dry-run", about: "list the files and the name, and upload nothing" },
      ...SITE_SETTINGS,
      ...installFlags("the site, or what --dry-run lists"),
    ],
    examples: [
      "poplin ./report",
      "poplin ./report.html",
      "poplin publish ./report",
      "poplin ./demo --unlisted --expires 7d",
      "poplin ./report --site report--k3f9x2ab71qz",
      "poplin ./report --site docs",
    ],
  },
  {
    name: "set",
    group: "one site",
    about: "change a site's settings",
    arguments: [{ ...SITE, required: true }],
    flags: [{ name: "--name", value: "<name>", about: "a new name; its id and every address stay" }, ...SITE_SETTINGS, ...installFlags("the site")],
    examples: [
      "poplin set report--k3f9x2ab71qz --unlisted",
      "poplin set report--k3f9x2ab71qz --public",
      "poplin set report--w8t1c5n0ze4u --public --public-name docs",
      "poplin set report--k3f9x2ab71qz --name q3-report",
      'poplin set report--k3f9x2ab71qz --title "Q3 sales"',
    ],
  },
  {
    name: "show",
    group: "one site",
    about: "look at a site",
    arguments: [{ ...SITE, required: true }],
    flags: installFlags("the site"),
    examples: [],
  },
  {
    name: "rollback",
    group: "one site",
    about: "go back a version",
    arguments: [{ ...SITE, required: true }],
    flags: [{ name: "--to", value: "<version>", about: "go to that version, not one back" }, ...installFlags("the site")],
    examples: ["poplin rollback report--k3f9x2ab71qz"],
  },
  {
    name: "new-link",
    group: "one site",
    about: "give a site a new id, so a new address",
    arguments: [{ ...SITE, required: true }],
    flags: installFlags("the site"),
    examples: ["poplin new-link report--k3f9x2ab71qz"],
  },
  {
    name: "duplicate",
    group: "one site",
    about: "make a private copy of a site, with a new address",
    arguments: [{ ...SITE, required: true }],
    flags: [{ name: "--name", value: "<name>", about: "the copy's name; the site's own without it" }, ...installFlags("the copy")],
    examples: ["poplin duplicate report--k3f9x2ab71qz", "poplin duplicate report --name report-draft"],
    notes: [
      "The copy holds the live version's files and the site's title and settings.",
      "It is always private, whatever the site is, and the site is not changed.",
    ],
  },
  {
    name: "delete",
    group: "one site",
    about: "move a site into the trash",
    arguments: [{ ...SITE, required: true }],
    flags: [{ name: "--forever", about: "remove it now, after you type its label" }, ...installFlags("the site, or what --forever left")],
    examples: ["poplin delete report--k3f9x2ab71qz", "poplin delete report"],
  },
  {
    name: "restore",
    group: "one site",
    about: "take a site back out of the trash",
    arguments: [{ ...SITE, required: true }],
    flags: installFlags("the site"),
    examples: [],
  },
  {
    name: "list",
    group: "all sites",
    about: "list every site",
    arguments: [],
    flags: [{ name: "--trash", about: "list the deleted sites instead" }, ...installFlags("the sites")],
    examples: ["poplin list", "poplin list --trash"],
  },
  {
    name: "login",
    group: "you, on this machine",
    about: "log this machine in: you allow it on the dashboard",
    arguments: [],
    flags: [
      { name: "--publisher", about: "save a publisher's token: only its own sites" },
      { name: "--name", value: "<name>", about: "what the dashboard calls this machine" },
      { name: "--no-browser", about: "print the address, and open no browser" },
      ...installFlags("the address and the code, then the login"),
    ],
    examples: ["poplin login --server https://poplin.example.com", "poplin login --publisher --name ci-runner"],
    notes: [
      "It prints an address and a code. Open the address in a browser where you",
      "are logged in to the dashboard, check the code, and allow it. The token is",
      "saved on this machine. With --json the address and the code are the first",
      "line, and the result the second.",
    ],
  },
  {
    name: "logout",
    group: "you, on this machine",
    about: "forget this machine's token",
    arguments: [],
    flags: installFlags("whether the token was revoked"),
    examples: ["poplin logout"],
  },
  {
    name: "whoami",
    group: "you, on this machine",
    about: "print the install, your role, and the token's id",
    arguments: [],
    flags: installFlags("the install, the token, and the version"),
    examples: ["poplin whoami"],
  },
  {
    name: "setup",
    group: "the install",
    about: "finish a new install with its provider's token",
    arguments: [],
    flags: [
      { name: "--check", about: "say what a setup would change, and change nothing" },
      { name: "--domain", value: "<domain>", about: "a new install's domain: example.com" },
      { name: "--login", value: "<email>", about: "the first login, or its correction" },
      ...installFlags("the rows and the steps"),
    ],
    examples: ["poplin setup --server https://poplin.example.com", "poplin setup --check --server https://poplin.example.com"],
    notes: [
      "The install does the work: this sends it the provider's token from",
      "POPLIN_SETUP_TOKEN and prints its rows. The token is never an argument and",
      "is never saved. It needs no login, and works only until somebody has",
      "logged in to the install: from then on the dashboard's Domain tab does the",
      "same. It makes no install: the install must already answer at --server.",
      "An install with nothing set yet takes two flags more, and gets its",
      "domain, its first login, and its account from this one run:",
      "  --domain example.com --login owner@example.com",
      "A first login that was mistyped is corrected the same way, until",
      "somebody has logged in: --login with the right email.",
      "To make the token, open /setup at that address in a browser: the page",
      "links the provider's form for a new token with its rights chosen.",
    ],
  },
  {
    name: "config",
    group: "the install",
    about: "show the install's settings, or change one",
    arguments: [
      { name: "key", about: "the setting to show; without it, every setting", required: false },
      { name: "value", about: "the value to give it: 7d, 9GB, 25%, on", required: false },
    ],
    flags: installFlags("the settings"),
    examples: ["poplin config", "poplin config versions_kept 10", "poplin config outside_pages allowed"],
    notes: [
      "outside_pages, search_engines_allowed, and block_bots are also held in",
      "rules on your domain. The install follows a changed outside_pages itself.",
      "The domain's side changes only when it is synced.",
    ],
  },
  {
    name: "doctor",
    group: "the install",
    about: "check that the install works, and report",
    arguments: [],
    flags: installFlags("the checks and the versions"),
    examples: ["poplin doctor"],
  },
  {
    name: "update",
    group: "the install",
    about: "update the install to the newest version",
    arguments: [],
    flags: [
      { name: "--check", about: "say what an update would do, and start nothing" },
      { name: "--anyway", about: "update even when no newer version is known" },
      { name: "--save-address", about: "save the update link from POPLIN_UPDATE_ADDRESS" },
      { name: "--forget-address", about: "remove the saved update link" },
      ...installFlags("what was started or found, or whether an update link is saved"),
    ],
    examples: ["poplin update", "poplin update --check", "poplin update --save-address"],
    notes: [
      "The update link is a secret address the install's provider gives. The",
      "install calls it to update itself: the provider builds the install",
      "again, and that build deploys the newest release. Make one at the",
      "provider once, put it in POPLIN_UPDATE_ADDRESS, and run",
      "poplin update --save-address. The link is never an argument. The",
      "install keeps it and never shows it again: --check says only that one",
      "is saved, and since when. One update a minute can be started.",
    ],
  },
  {
    name: "export",
    group: "the install",
    about: "download everything, or one site, as a zip",
    arguments: [{ ...SITE, about: "the one site to export; without it, every site", required: false }],
    flags: [
      { name: "--out", value: "<file>", about: "the zip to write; poplin-backup-<day>.zip without it" },
      { name: "--overwrite", about: "replace a file that is already there" },
      { name: "--all-versions", about: "add the kept versions" },
      ...installFlags("the zip's file and its sites"),
    ],
    examples: ["poplin export", "poplin export --all-versions --out backup.zip", "poplin export report--k3f9x2ab71qz"],
    notes: ["The zip holds plain files: every site's record and files, and the settings.", "It holds no token and no signing key."],
  },
  {
    name: "import",
    group: "the install",
    about: "put a backup back",
    arguments: [{ name: "zip", about: "the zip that export made", required: true }],
    flags: [
      { name: "--site", value: "<site>", about: "import that one site of the backup" },
      { name: "--settings", about: "replace the install's settings, but for the logins" },
      { name: "--logins", about: "with --settings: replace the logins too" },
      { name: "--dry-run", about: "check the zip and list its sites, and import nothing" },
      ...installFlags("the sites, and the counts unless --dry-run"),
    ],
    examples: ["poplin import backup.zip", "poplin import backup.zip --dry-run", "poplin import backup.zip --site report--k3f9x2ab71qz"],
    notes: [
      "The whole zip is checked before anything is sent. A site the install",
      "already has is skipped: nothing is ever overwritten. A site too large to",
      "import with every version is imported with its live version alone.",
    ],
  },
  {
    name: "mcp",
    group: "the install",
    about: "run the MCP server on this machine, over stdio",
    arguments: [],
    flags: EVERYWHERE,
    examples: ["poplin mcp"],
  },
  {
    name: "help",
    group: "help",
    about: "show the help of a command",
    arguments: [{ name: "command", about: "the command to explain; without it, every command", required: false }],
    flags: EVERYWHERE,
    examples: [],
  },
] as const satisfies readonly CommandSpec[];

/** One flag of a command. A flag with a `value` takes one; a flag without is a switch. */
interface FlagSpec {
  readonly name: `--${string}`;
  readonly value?: string;
  readonly about: string;
}

/** One command: the word that runs it, the arguments it takes in order, the flags it accepts, and what its help adds in whole lines. */
export interface CommandSpec {
  readonly name: string;
  readonly group: string;
  readonly about: string;
  readonly arguments: readonly { readonly name: string; readonly about: string; readonly required: boolean }[];
  readonly flags: readonly FlagSpec[];
  readonly examples: readonly string[];
  readonly notes?: readonly string[];
}

/** The word of a command in the table. */
export type CommandName = (typeof COMMANDS)[number]["name"];

/**
 * The flags of a command that talks to an install.
 *
 * @param prints - what the command's `--json` prints once it is done, as the words that follow `print JSON:`
 */
function installFlags(prints: string): readonly FlagSpec[] {
  return [
    { name: "--json", about: `print JSON: ${prints}, or the error object` },
    { name: "--server", value: "<address>", about: "the address of the install to talk to" },
    ...EVERYWHERE,
  ];
}
