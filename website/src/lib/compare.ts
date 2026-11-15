/** What one tool's own pages say to a row: a plain answer, and the fact behind it for a reader who wants it. */
type Answer = readonly ["yes" | "no" | "partly" | "not stated", string];

/** One row of the comparison: a short label and what it means in full. */
interface Row {
  readonly id: string;
  readonly ask: string;
  readonly means: string;
}

/** The rows, from what matters most to a person handing a folder to an agent. */
export const ROWS: readonly Row[] = [
  { id: "private", ask: "Private login", means: "A site can be private, opened only after a login" },
  { id: "own", ask: "Your own account", means: "Your files stay in an account you own" },
  { id: "signup", ask: "No sign-up", means: "No account with the tool's own company" },
  { id: "free", ask: "Free to run", means: "Runs within a free plan" },
  { id: "mcp", ask: "MCP", means: "An MCP server, so an AI agent can publish" },
  { id: "folders", ask: "Whole folders", means: "A whole website of many files, not one page" },
  { id: "samelink", ask: "Same link on update", means: "A new version keeps the same link" },
  { id: "rollback", ask: "Rollback", means: "Go back to an earlier version" },
  { id: "newlink", ask: "New link if leaked", means: "Give a site a new link, and the old one stops working" },
  { id: "bots", ask: "Blocks bots", means: "Crawlers and floods are stopped before they reach a site" },
  { id: "source", ask: "Source public", means: "The source code is public to read" },
];

/** The tools in column order, poplin first; an answer is what the tool's own pages say, "not stated" when they do not. */
export const TOOLS: readonly { readonly name: string; readonly answers: Readonly<Record<string, Answer>> }[] = [
  {
    name: "poplin",
    answers: {
      private: ["yes", "Private is the default; the owner logs in"],
      own: ["yes", "Your own Cloudflare account"],
      signup: ["yes", "Only your Cloudflare account"],
      free: ["yes", "Fits Cloudflare's free plan"],
      mcp: ["yes", "A local MCP server"],
      folders: ["yes", "A whole folder of website files"],
      samelink: ["yes", "An update keeps the site's address"],
      rollback: ["yes", "Earlier versions are kept"],
      newlink: ["yes", "A new address, and the old one stops"],
      bots: ["partly", "You choose: a firewall rule, a crawler block, and a rate limit, on with three optional token permissions"],
      source: ["yes", "Public, under the Individual and Small Organization License"],
    },
  },
  {
    name: "here.now",
    answers: {
      private: ["yes", "An allowlist of email addresses or domains"],
      own: ["no", "Hosted by here.now"],
      signup: ["partly", "A site published with no account lasts 24 hours"],
      free: ["yes", "A free plan: 500 sites, 10 GB"],
      mcp: ["no", "A skill and an API; its docs claim no MCP"],
      folders: ["yes", "Sites of many files"],
      samelink: ["yes", "An update goes to the same site"],
      rollback: ["yes", "Any earlier version can be restored"],
      newlink: ["partly", "Duplicate the site to a new name, then delete the old one"],
      bots: ["not stated", "Its pages do not say"],
      source: ["not stated", "Its pages do not say; its agent skill is public"],
    },
  },
  {
    name: "Claude artifacts",
    answers: {
      private: ["yes", "Invite people by email; they sign in"],
      own: ["no", "Hosted by Anthropic"],
      signup: ["no", "Needs a Claude account"],
      free: ["partly", "Sharing by link needs a paid plan; older publishing is free"],
      mcp: ["not stated", "Its pages do not say"],
      folders: ["not stated", "Its pages do not say whether one artifact can be a site of many files"],
      samelink: ["yes", "People with the link see the new version, with no new link"],
      rollback: ["partly", "A version history with a restore is documented for some artifacts"],
      newlink: ["not stated", "Its pages do not say"],
      bots: ["not stated", "Its pages do not say"],
      source: ["not stated", "Its pages do not say"],
    },
  },
  {
    name: "tiiny.host",
    answers: {
      private: ["yes", "Approved email addresses, on a paid plan"],
      own: ["no", "Hosted by tiiny.host"],
      signup: ["no", "Needs an account"],
      free: ["partly", "Free: one project of 3 MB"],
      mcp: ["yes", "A hosted MCP server"],
      folders: ["yes", "A zip or a build folder"],
      samelink: ["yes", "The link stays the same"],
      rollback: ["not stated", "Its pages do not say"],
      newlink: ["not stated", "Its pages do not say"],
      bots: ["not stated", "Can be hidden from search engines, on a paid plan; blocking is not stated"],
      source: ["not stated", "Its pages do not say"],
    },
  },
  {
    name: "Pagecast",
    answers: {
      private: ["no", "A password per page, no login"],
      own: ["yes", "Your own Cloudflare account"],
      signup: ["yes", "Only your Cloudflare account"],
      free: ["yes", "Free, on Cloudflare's free Pages"],
      mcp: ["yes", "A local MCP server"],
      folders: ["yes", "Static sites of many files"],
      samelink: ["yes", "A repeat publish updates the same link"],
      rollback: ["not stated", "A deploy history; no restore is documented"],
      newlink: ["partly", "Revoke and redeploy; older deploy links need pruning"],
      bots: ["not stated", "Asks search engines not to index; blocking is not stated"],
      source: ["yes", "MIT"],
    },
  },
  {
    name: "sharehtml",
    answers: {
      private: ["yes", "Cloudflare Access, if you turn it on"],
      own: ["yes", "Your own Cloudflare account"],
      signup: ["yes", "Only your Cloudflare account"],
      free: ["not stated", "Its storage has a free tier; the cost of the whole is not given"],
      mcp: ["not stated", "Its pages name a skill, not an MCP server"],
      folders: ["no", "One file at a time"],
      samelink: ["yes", "A redeploy updates the same link"],
      rollback: ["not stated", "Its pages do not say"],
      newlink: ["not stated", "Its pages do not say"],
      bots: ["not stated", "Its pages do not say"],
      source: ["yes", "Apache-2.0"],
    },
  },
];
