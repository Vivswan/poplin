// The command table: every command, its arguments, and its flags. The parser accepts what it lists and the help prints what it lists, so the two cannot disagree.

/** The flag that asks for a command's help. */
export const HELP_FLAG = "--help";

/** The flag that asks for the version. */
export const VERSION_FLAG = "--version";

/** The flag that turns `poplin doctor` into a repair with an account token, whose words its own parser reads. */
export const REPAIR_FLAG = "--repair";

/** The flag that asks for the help of every command at once, which works with no command alone. */
export const FULL_HELP = { name: "--full-help", about: "Show the help of every command" } as const satisfies FlagSpec;

/** The two flags every command takes. */
const EVERYWHERE: readonly FlagSpec[] = [
  { name: HELP_FLAG, about: "Show this help" },
  { name: VERSION_FLAG, about: "Print the version" },
];

/** The argument that names one site. */
const SITE = { name: "site", about: "Site label, id, public name, or URL" };

/** The settings of a site, the same when it is published and when it is changed. */
const SITE_SETTINGS: readonly FlagSpec[] = [
  { name: "--private", about: "Restrict to the users of this install" },
  { name: "--unlisted", about: "Allow anyone who has the URL" },
  { name: "--public", about: "Allow everyone, at its public name" },
  { name: "--public-name", value: "<name>", about: "With --public: the public name, when not its name" },
  { name: "--title", value: "<title>", about: 'Dashboard title; "" uses the page\'s own' },
  { name: "--search-engines", value: "on|off", about: "Allow search indexing, if the install permits" },
  { name: "--embeddable", value: "on|off", about: "Allow other pages to frame it and load its files" },
  { name: "--expires", value: "<when>", about: "Move to the trash at: 7d, 2026-12-01, never" },
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

/** The commands that work at a provider, as their rows of the help: the providers and their options are known only when one runs, so its own parser reads its words. The first leads the group of the commands about an install, and the last ends it. */
export const PROVIDER_COMMANDS = [
  {
    name: "install",
    group: "Install:",
    about: "Install poplin in your provider account",
    arguments: [{ name: "provider", about: "Where to install (default: list the providers)", required: false }],
  },
  {
    name: "uninstall",
    group: "Install:",
    about: "Remove the install from the provider",
    arguments: [{ name: "provider", about: "Where the install is (default: list the providers)", required: false }],
  },
] as const;

/** Every command, in the order the help lists them. */
export const COMMANDS = [
  {
    name: "publish",
    group: "Publish:",
    about: "Publish a folder or one HTML file; --site updates",
    arguments: [{ name: "path", about: "A folder with an index.html, or one HTML file", required: true }],
    flags: [
      { name: "--site", value: "<site>", about: "Update this site: label, id, public name, or URL" },
      { name: "--name", value: "<name>", about: "Site name; with --site, rename it" },
      { name: "--dry-run", about: "List the files and the name; upload nothing" },
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
    notes: ["poplin <path> runs publish. A first word is a path when it starts with", ". ~ or a drive (C:), or contains / or \\"],
  },
  {
    name: "set",
    group: "Sites:",
    about: "Change a site's access, name, title, expiry, etc.",
    arguments: [{ ...SITE, required: true }],
    flags: [
      { name: "--name", value: "<name>", about: "Rename; the id and every URL stay" },
      dryRun("Show what would change; change nothing"),
      ...SITE_SETTINGS,
      ...installFlags("the site, or what --dry-run says it would be"),
    ],
    examples: [
      "poplin set report--k3f9x2ab71qz --unlisted",
      "poplin set report--k3f9x2ab71qz --public",
      "poplin set report--w8t1c5n0ze4u --public --public-name docs",
      "poplin set report--k3f9x2ab71qz --name q3-report",
      'poplin set report--k3f9x2ab71qz --title "Q3 sales"',
      "poplin set report--k3f9x2ab71qz --public --dry-run",
    ],
  },
  {
    name: "show",
    group: "Sites:",
    about: "Show a site's details",
    arguments: [{ ...SITE, required: true }],
    flags: installFlags("the site"),
    examples: [],
  },
  {
    name: "rollback",
    group: "Sites:",
    about: "Roll back to the previous version, or --to <version>",
    arguments: [{ ...SITE, required: true }],
    flags: [
      { name: "--to", value: "<version>", about: "Roll back to this version instead of the previous" },
      dryRun("Show which version would be live; change nothing"),
      ...installFlags("the site, or what --dry-run says it would be"),
    ],
    examples: ["poplin rollback report--k3f9x2ab71qz", "poplin rollback report--k3f9x2ab71qz --dry-run"],
  },
  {
    name: "new-link",
    group: "Sites:",
    about: "Rotate the site id (new URL)",
    arguments: [{ ...SITE, required: true }],
    flags: [dryRun("Show which URL would stop working; change nothing"), ...installFlags("the site; with --dry-run, the site as it is")],
    examples: ["poplin new-link report--k3f9x2ab71qz"],
  },
  {
    name: "duplicate",
    group: "Sites:",
    about: "Copy a site as private, under a new id",
    arguments: [{ ...SITE, required: true }],
    flags: [
      { name: "--name", value: "<name>", about: "Name of the copy (default: the site's name)" },
      dryRun("Show what the copy would be; copy nothing"),
      ...installFlags("the copy, or what --dry-run says it would be"),
    ],
    examples: ["poplin duplicate report--k3f9x2ab71qz", "poplin duplicate report--k3f9x2ab71qz --name report-draft"],
    notes: [
      "The copy holds the live version's files and the site's settings, except",
      "the expiry, which is set as for a new site. Its title is the site's with",
      "(copy) appended, unless it already ends that way. The copy is always",
      "private, and the source site is unchanged.",
    ],
  },
  {
    name: "delete",
    group: "Sites:",
    about: "Move a site to the trash; --no-trash deletes it",
    arguments: [{ ...SITE, required: true }],
    flags: [
      { name: "--no-trash", about: "Delete permanently, after you type its label" },
      dryRun("Show what would be deleted; delete nothing"),
      ...installFlags("the site, or what --no-trash left"),
    ],
    examples: ["poplin delete report--k3f9x2ab71qz", "poplin delete report", "poplin delete report --no-trash --dry-run"],
  },
  {
    name: "restore",
    group: "Sites:",
    about: "Restore a site from the trash",
    arguments: [{ ...SITE, required: true }],
    flags: [dryRun("Show what would be restored; restore nothing"), ...installFlags("the site, or what --dry-run says it would be")],
    examples: [],
  },
  {
    name: "list",
    group: "Sites:",
    about: "List sites",
    arguments: [],
    flags: [{ name: "--trash", about: "List the sites in the trash instead" }, ...installFlags("the sites")],
    examples: ["poplin list", "poplin list --trash"],
  },
  {
    name: "login",
    group: "Auth:",
    about: "Authenticate this machine (approve in the dashboard)",
    arguments: [],
    flags: [
      { name: "--publisher", about: "Store a publisher token: its own sites only" },
      { name: "--name", value: "<name>", about: "Name of this machine in the dashboard" },
      { name: "--no-browser", about: "Print the URL; do not open a browser" },
      ...installFlags("the URL and the code, then the login"),
    ],
    examples: ["poplin login --server https://poplin.example.com", "poplin login --publisher --name ci-runner"],
    notes: [
      "Prints a URL and a code. Open the URL in a browser that is logged in to",
      "the dashboard, compare the code, and approve. The token is stored on this",
      "machine. With --json the URL and the code are the first line, and the",
      "result the second.",
    ],
  },
  {
    name: "logout",
    group: "Auth:",
    about: "Revoke and delete the stored token",
    arguments: [],
    flags: [dryRun("Show what a logout would do; keep the login"), ...installFlags("whether the token was revoked, or would be")],
    examples: ["poplin logout", "poplin logout --dry-run"],
  },
  {
    name: "whoami",
    group: "Auth:",
    about: "Print the server, role, and token id",
    arguments: [],
    flags: installFlags("the install, the token, and the version"),
    examples: ["poplin whoami"],
  },
  {
    name: "config",
    group: "Install:",
    about: "Get or set install settings",
    arguments: [
      { name: "key", about: "Setting to show (default: all)", required: false },
      { name: "value", about: "New value: 7d, 9GB, 25%, on", required: false },
    ],
    flags: [dryRun("With a value: show the result; change nothing"), ...installFlags("the settings, or the one named as key and value")],
    examples: ["poplin config", "poplin config versions_kept 10", "poplin config outside_pages allowed", "poplin config trash_days 9 --dry-run"],
    notes: [
      "outside_pages, search_engines_allowed, and block_bots also change your",
      "domain. An install that holds its key writes the rules of the first two",
      "itself. block_bots is applied at the next Repair on Domain.",
    ],
  },
  {
    name: "doctor",
    group: "Install:",
    about: "Check the install; --repair fixes it",
    arguments: [],
    flags: [
      { name: REPAIR_FLAG, about: "Repair the install with a provider account token" },
      { name: "--update", about: "Update to the latest release first", with: REPAIR_FLAG },
      { name: "--dry-run", about: "Show the changes; change nothing", with: REPAIR_FLAG },
      { name: "--add-user", value: "<email>", about: "Allow one more person to log in", with: REPAIR_FLAG },
      { name: "--yes", about: "Never prompt", with: REPAIR_FLAG },
      { name: "--token-stdin", about: "Read the account token from stdin", with: REPAIR_FLAG },
      ...installFlags("the checks and the versions, or the --repair result"),
    ],
    examples: ["poplin doctor"],
    notes: [
      "--repair needs an account token and no login, so it also recovers access:",
      "  poplin doctor --repair --dry-run",
      "  poplin doctor --repair --add-user you@example.com",
      "--repair installs a newer release only with --update:",
      "  poplin doctor --repair --update",
      "--repair takes no --server. Provider options and token input:",
      "  poplin doctor --repair --help",
    ],
  },
  {
    name: "update",
    group: "Install:",
    about: "Update the install to the latest release",
    arguments: [],
    flags: [
      { name: "--dry-run", about: "Show what an update would do; start nothing" },
      { name: "--to", value: "<version>", about: "Install this version instead; a lower one downgrades" },
      ...installFlags("what was installed, or what a start would do"),
    ],
    examples: ["poplin update", "poplin update --dry-run", "poplin update --to 0.2.0"],
    notes: [
      "The install downloads the built files of the latest release, verifies",
      "them against what the project published, and replaces its running code",
      "using the key it holds. Nothing is built. An install without a key cannot",
      "update itself: --dry-run reports which it is. At most one update can be",
      "started per minute. --to with a lower version downgrades by the same",
      "steps; it is refused when the database changed after that version, whose",
      "code cannot read it. --dry-run names the version the install can",
      "downgrade to.",
    ],
  },
  {
    name: "export",
    group: "Backup:",
    about: "Export all sites, or one, as a zip",
    arguments: [{ ...SITE, about: "Site to export (default: all)", required: false }],
    flags: [
      { name: "--out", value: "<file>", about: "Output zip (default: poplin-backup-<day>.zip)" },
      { name: "--overwrite", about: "Replace an existing file" },
      { name: "--all-versions", about: "Include the kept versions" },
      ...installFlags("the zip's file and its sites"),
    ],
    examples: ["poplin export", "poplin export --all-versions --out backup.zip", "poplin export report--k3f9x2ab71qz"],
    notes: ["The zip holds plain files: each site's record and files, and the settings.", "It holds no token and no key of the install."],
  },
  {
    name: "import",
    group: "Backup:",
    about: "Import a backup zip",
    arguments: [{ name: "zip", about: "A zip made by export", required: true }],
    flags: [
      { name: "--site", value: "<site>", about: "Import only this site" },
      { name: "--settings", about: "Replace the install's settings, except the users" },
      { name: "--users", about: "With --settings: replace the users (logins) too" },
      { name: "--dry-run", about: "Validate the zip and list its sites; import nothing" },
      ...installFlags("the sites, and the counts unless --dry-run"),
    ],
    examples: ["poplin import backup.zip", "poplin import backup.zip --dry-run", "poplin import backup.zip --site report--k3f9x2ab71qz"],
    notes: [
      "The whole zip is validated before anything is sent. A site the install",
      "already has is skipped: nothing is overwritten. A site too large to",
      "import with every version is imported with its live version only.",
    ],
  },
  {
    name: "mcp",
    group: "Agent:",
    about: "Run the MCP server over stdio",
    arguments: [],
    flags: EVERYWHERE,
    examples: ["poplin mcp"],
  },
  {
    name: "help",
    group: "Help:",
    about: "Show help for a command",
    arguments: [{ name: "command", about: "Command to explain (default: all)", required: false }],
    flags: EVERYWHERE,
    examples: [],
  },
] as const satisfies readonly CommandSpec[];

/** One flag of a command. A flag with a `value` takes one; a flag without is a switch. A flag `with` another is refused without it, and the help lists it under that one. */
interface FlagSpec {
  readonly name: `--${string}`;
  readonly value?: string;
  readonly about: string;
  readonly with?: `--${string}`;
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

/** The flag that asks what a command would do, with nothing changed, in the words of one command. */
function dryRun(about: string): FlagSpec {
  return { name: "--dry-run", about };
}

/**
 * The flags of a command that talks to an install.
 *
 * @param prints - what the command's `--json` prints once it is done, as the words that follow `print JSON:`
 */
function installFlags(prints: string): readonly FlagSpec[] {
  return [
    { name: "--json", about: `Print JSON: ${prints}, or the error object` },
    { name: "--server", value: "<address>", about: "Address of the install to use" },
    ...EVERYWHERE,
  ];
}
