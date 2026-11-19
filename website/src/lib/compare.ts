/** What one tool's own pages say to a row. */
type Mark = "yes" | "no" | "partly" | "not stated";

/** A thing poplin does not do, which the issue of this number on its repository asks for. */
interface Request {
  readonly kind: "request";
  readonly issue: number;
}

/** One cell of the comparison: a mark, or for poplin a request. */
export type Cell = Mark | Request;

/** The rows by their key in each tool's answers and their short label, from what matters most to a person handing a folder to an agent; what poplin lacks comes last. */
export const ROWS = [
  { id: "private", ask: "Private sites" },
  { id: "own", ask: "Self-hosted" },
  { id: "signup", ask: "No sign-up" },
  { id: "free", ask: "Free tier" },
  { id: "mcp", ask: "Local MCP" },
  { id: "folders", ask: "Multi-page sites" },
  { id: "samelink", ask: "Shareable link" },
  { id: "rollback", ask: "Rollback" },
  { id: "newlink", ask: "New link if leaked" },
  { id: "bots", ask: "Bot blocking" },
  { id: "source", ask: "Source available" },
  { id: "chat", ask: "Chat apps" },
  { id: "people", ask: "Per-site access" },
  { id: "nosetup", ask: "No setup" },
] as const;

/** The tools in column order, poplin first; an answer is what the tool's own pages say, "not stated" when they do not. */
export const TOOLS: readonly { readonly name: string; readonly answers: Readonly<Record<(typeof ROWS)[number]["id"], Cell>> }[] = [
  {
    name: "poplin",
    answers: {
      private: "yes",
      own: "yes",
      signup: "yes",
      free: "yes",
      mcp: "yes",
      folders: "yes",
      samelink: "yes",
      rollback: "yes",
      newlink: "yes",
      bots: "yes",
      source: "yes",
      chat: { kind: "request", issue: 11 },
      people: { kind: "request", issue: 21 },
      nosetup: { kind: "request", issue: 456 },
    },
  },
  {
    name: "here.now",
    answers: {
      private: "yes",
      own: "no",
      signup: "partly",
      free: "yes",
      mcp: "no",
      folders: "yes",
      samelink: "yes",
      rollback: "yes",
      newlink: "partly",
      bots: "not stated",
      source: "not stated",
      chat: "no",
      people: "yes",
      nosetup: "yes",
    },
  },
  {
    name: "Claude artifacts",
    answers: {
      private: "yes",
      own: "no",
      signup: "no",
      free: "yes",
      mcp: "not stated",
      folders: "not stated",
      samelink: "yes",
      rollback: "partly",
      newlink: "not stated",
      bots: "not stated",
      source: "not stated",
      chat: "yes",
      people: "yes",
      nosetup: "not stated",
    },
  },
  {
    name: "tiiny.host",
    answers: {
      private: "yes",
      own: "no",
      signup: "no",
      free: "yes",
      mcp: "no",
      folders: "yes",
      samelink: "yes",
      rollback: "yes",
      newlink: "partly",
      bots: "not stated",
      source: "not stated",
      chat: "yes",
      people: "yes",
      nosetup: "not stated",
    },
  },
  {
    name: "Pagecast",
    answers: {
      private: "partly",
      own: "yes",
      signup: "yes",
      free: "yes",
      mcp: "yes",
      folders: "yes",
      samelink: "yes",
      rollback: "not stated",
      newlink: "partly",
      bots: "not stated",
      source: "yes",
      chat: "no",
      people: "partly",
      nosetup: "no",
    },
  },
  {
    name: "sharehtml",
    answers: {
      private: "yes",
      own: "yes",
      signup: "yes",
      free: "not stated",
      mcp: "not stated",
      folders: "no",
      samelink: "yes",
      rollback: "not stated",
      newlink: "not stated",
      bots: "not stated",
      source: "yes",
      chat: "not stated",
      people: "yes",
      nosetup: "no",
    },
  },
];
