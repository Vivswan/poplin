// The command table: every command, its arguments, and its flags. The parser accepts what it lists and the help prints what it lists, so the two cannot disagree.

/** The flag that asks for a command's help. */
export const HELP_FLAG = "--help";

/** The flag that asks for the version. */
export const VERSION_FLAG = "--version";

/** The flag that turns `poplin doctor` into a repair with an account token, whose words its own parser reads. */
export const REPAIR_FLAG = "--repair";

/** The flag that asks for the help of every command at once, which works with no command alone. */
export const FULL_HELP = { name: "--full-help", about: "Show every command's help" } as const satisfies FlagSpec;

/** What the flags that more than one parser reads mean, the same in every help that lists them. */
export const FLAG_WORDS = {
  dryRun: "Show what would change. Change nothing.",
  repair: "Repair the install with an account token",
  update: "Update to the latest version first",
  addUser: "Add one user",
  yes: "Never prompt. A missing answer stops the run.",
  tokenStdin: "Read the account token from stdin",
} as const;

/** The two flags every command takes, whose names say what they do. */
const EVERYWHERE: readonly FlagSpec[] = [
  { name: HELP_FLAG, about: "" },
  { name: VERSION_FLAG, about: "" },
];

/** The flags of a command that talks to an install. */
const INSTALL_FLAGS: readonly FlagSpec[] = [{ name: "--json", about: "" }, { name: "--server", value: "<address>", about: "Address of the install" }, ...EVERYWHERE];

/** The flag that asks what a command would do, with nothing changed. */
const DRY_RUN: FlagSpec = { name: "--dry-run", about: FLAG_WORDS.dryRun };

/** The argument that names one site. */
const SITE = { name: "site", about: "Site label, id, public name, or URL" };

/** The settings of a site, the same when it is published and when it is changed. */
const SITE_SETTINGS: readonly FlagSpec[] = [
  { name: "--private", about: "Only users of this install can open it" },
  { name: "--unlisted", about: "Anyone with the URL can open it" },
  { name: "--public", about: "Everyone can open it, at its public name" },
  { name: "--public-name", value: "<name>", about: "", with: "--public" },
  { name: "--title", value: "<title>", about: 'Dashboard title\n"" uses the page title.' },
  { name: "--search-engines", value: "on|off", about: "Allow search indexing, if the install permits" },
  { name: "--embeddable", value: "on|off", about: "Allow other pages to frame it and load its files" },
  { name: "--expires", value: "<when>", about: "Move to the trash after 7d, on 2026-12-01, or never" },
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
    about: "Publish a folder or one HTML file",
    arguments: [{ name: "path", about: "A folder with an index.html, or one HTML file\nWith no publish command, prefix the path: ./report", required: true }],
    flags: [
      { name: "--site", value: "<site>", about: "Update this site: label, id, public name, or URL" },
      { name: "--name", value: "<name>", about: "Name the site. With --site, rename it." },
      DRY_RUN,
      ...SITE_SETTINGS,
      ...INSTALL_FLAGS,
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
    group: "Sites:",
    about: "Change a site's settings",
    arguments: [{ ...SITE, required: true }],
    flags: [
      { name: "--name", value: "<name>", about: "Rename the site. Its id and URLs stay." },
      DRY_RUN,
      ...SITE_SETTINGS,
      ...INSTALL_FLAGS,
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
    flags: INSTALL_FLAGS,
    examples: [],
  },
  {
    name: "rollback",
    group: "Sites:",
    about: "Roll back a site to its previous version",
    arguments: [{ ...SITE, required: true }],
    flags: [
      { name: "--to", value: "<version>", about: "Roll back to this version instead" },
      DRY_RUN,
      ...INSTALL_FLAGS,
    ],
    examples: ["poplin rollback report--k3f9x2ab71qz", "poplin rollback report--k3f9x2ab71qz --dry-run"],
  },
  {
    name: "new-link",
    group: "Sites:",
    about: "Rotate a site id. URLs with the old id stop working.",
    arguments: [{ ...SITE, required: true }],
    flags: [DRY_RUN, ...INSTALL_FLAGS],
    examples: ["poplin new-link report--k3f9x2ab71qz"],
  },
  {
    name: "duplicate",
    group: "Sites:",
    about: "Make a private copy of a site",
    arguments: [{ ...SITE, required: true }],
    flags: [
      { name: "--name", value: "<name>", about: "Name of the copy (default: the site's name)" },
      DRY_RUN,
      ...INSTALL_FLAGS,
    ],
    examples: ["poplin duplicate report--k3f9x2ab71qz", "poplin duplicate report--k3f9x2ab71qz --name report-draft"],
  },
  {
    name: "delete",
    group: "Sites:",
    about: "Move a site to the trash",
    arguments: [{ ...SITE, required: true }],
    flags: [
      { name: "--no-trash", about: "Delete permanently. Prompts for the site's label." },
      DRY_RUN,
      ...INSTALL_FLAGS,
    ],
    examples: ["poplin delete report--k3f9x2ab71qz", "poplin delete report", "poplin delete report --no-trash --dry-run"],
  },
  {
    name: "restore",
    group: "Sites:",
    about: "Restore a site from the trash",
    arguments: [{ ...SITE, required: true }],
    flags: [DRY_RUN, ...INSTALL_FLAGS],
    examples: [],
  },
  {
    name: "list",
    group: "Sites:",
    about: "List sites",
    arguments: [],
    flags: [{ name: "--trash", about: "List trashed sites instead" }, ...INSTALL_FLAGS],
    examples: ["poplin list", "poplin list --trash"],
  },
  {
    name: "login",
    group: "Auth:",
    about: "Log this machine in. Approve it in the dashboard.",
    arguments: [],
    flags: [
      { name: "--publisher", about: "Store a publisher token, limited to its own sites" },
      { name: "--name", value: "<name>", about: "Machine name in the dashboard" },
      { name: "--no-browser", about: "" },
      ...INSTALL_FLAGS,
    ],
    examples: ["poplin login --server https://poplin.example.com", "poplin login --publisher --name ci-runner"],
  },
  {
    name: "logout",
    group: "Auth:",
    about: "Revoke and delete the stored token",
    arguments: [],
    flags: [DRY_RUN, ...INSTALL_FLAGS],
    examples: ["poplin logout", "poplin logout --dry-run"],
  },
  {
    name: "whoami",
    group: "Auth:",
    about: "Show the install, role, and token id",
    arguments: [],
    flags: INSTALL_FLAGS,
    examples: ["poplin whoami"],
  },
  {
    name: "config",
    group: "Install:",
    about: "Get or set install settings",
    arguments: [
      { name: "key", about: "Setting to get or set (default: get all)", required: false },
      { name: "value", about: "New value: 7d, 9GB, 25%, on", required: false },
    ],
    flags: [DRY_RUN, ...INSTALL_FLAGS],
    examples: ["poplin config", "poplin config versions_kept 10", "poplin config outside_pages allowed", "poplin config trash_days 9 --dry-run"],
  },
  {
    name: "doctor",
    group: "Install:",
    about: "Check the install, or repair it with --repair",
    arguments: [],
    flags: [
      { name: REPAIR_FLAG, about: FLAG_WORDS.repair },
      { name: "--update", about: FLAG_WORDS.update, with: REPAIR_FLAG },
      { ...DRY_RUN, with: REPAIR_FLAG },
      { name: "--add-user", value: "<email>", about: FLAG_WORDS.addUser, with: REPAIR_FLAG },
      { name: "--yes", about: FLAG_WORDS.yes, with: REPAIR_FLAG },
      { name: "--token-stdin", about: FLAG_WORDS.tokenStdin, with: REPAIR_FLAG },
      ...INSTALL_FLAGS,
    ],
    examples: ["poplin doctor", "poplin doctor --repair --help", "poplin doctor --repair --dry-run", "poplin doctor --repair --add-user you@example.com", "poplin doctor --repair --update"],
  },
  {
    name: "update",
    group: "Install:",
    about: "Update the install to the latest version",
    arguments: [],
    flags: [
      { name: "--to", value: "<version>", about: "Update to this version instead\nA downgrade can only undo the last update.\nA downgrade fails if the update changed the schema." },
      DRY_RUN,
      ...INSTALL_FLAGS,
    ],
    examples: ["poplin update", "poplin update --dry-run", "poplin update --to 0.2.0"],
  },
  {
    name: "export",
    group: "Backup:",
    about: "Export all sites, or one, as a zip",
    arguments: [{ ...SITE, required: false }],
    flags: [
      { name: "--out", value: "<file>", about: "Output zip (default: poplin-backup-<day>.zip)" },
      { name: "--overwrite", about: "" },
      { name: "--all-versions", about: "Include the kept versions" },
      ...INSTALL_FLAGS,
    ],
    examples: ["poplin export", "poplin export --all-versions --out backup.zip", "poplin export report--k3f9x2ab71qz"],
  },
  {
    name: "import",
    group: "Backup:",
    about: "Import a backup zip without overwriting sites",
    arguments: [{ name: "zip", about: "A zip made by export", required: true }],
    flags: [
      { name: "--site", value: "<site>", about: "Import only this site" },
      { name: "--settings", about: "Replace the install's settings, except the users" },
      { name: "--users", about: "Replace the users too", with: "--settings" },
      DRY_RUN,
      ...INSTALL_FLAGS,
    ],
    examples: ["poplin import backup.zip", "poplin import backup.zip --dry-run", "poplin import backup.zip --site report--k3f9x2ab71qz"],
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
    arguments: [{ name: "command", about: "Command to explain (default: the overview)", required: false }],
    flags: EVERYWHERE,
    examples: [],
  },
] as const satisfies readonly CommandSpec[];

/** One flag of a command: a switch, or with a `value` one that takes it. One `with` another is listed under it in the help. An empty `about` is for a name that says it all; a case to know before a run is a sentence on a line of its own. */
interface FlagSpec {
  readonly name: `--${string}`;
  readonly value?: string;
  readonly about: string;
  readonly with?: `--${string}`;
}

/** One command: the word that runs it, the arguments it takes in order, the flags it accepts, and the command lines its help shows. */
export interface CommandSpec {
  readonly name: string;
  readonly group: string;
  readonly about: string;
  readonly arguments: readonly { readonly name: string; readonly about: string; readonly required: boolean }[];
  readonly flags: readonly FlagSpec[];
  readonly examples: readonly string[];
}

/** The word of a command in the table. */
export type CommandName = (typeof COMMANDS)[number]["name"];
