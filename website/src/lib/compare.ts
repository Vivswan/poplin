/** What one tool's own pages say to a row. */
type Answer = "yes" | "no" | "partly" | "not stated";

/** One row of the comparison: its key in each tool's answers, and its short label. */
interface Row {
  readonly id: string;
  readonly ask: string;
}

/** The rows, from what matters most to a person handing a folder to an agent. */
export const ROWS: readonly Row[] = [
  { id: "private", ask: "Private login" },
  { id: "own", ask: "Your own account" },
  { id: "signup", ask: "No sign-up" },
  { id: "free", ask: "Free to run" },
  { id: "mcp", ask: "MCP" },
  { id: "folders", ask: "Whole folders" },
  { id: "samelink", ask: "Same link on update" },
  { id: "rollback", ask: "Rollback" },
  { id: "newlink", ask: "New link if leaked" },
  { id: "bots", ask: "Blocks bots" },
  { id: "source", ask: "Source public" },
];

/** The tools in column order, poplin first; an answer is what the tool's own pages say, "not stated" when they do not. */
export const TOOLS: readonly { readonly name: string; readonly answers: Readonly<Record<string, Answer>> }[] = [
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
      bots: "partly",
      source: "yes",
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
    },
  },
  {
    name: "Claude artifacts",
    answers: {
      private: "yes",
      own: "no",
      signup: "no",
      free: "partly",
      mcp: "not stated",
      folders: "not stated",
      samelink: "yes",
      rollback: "partly",
      newlink: "not stated",
      bots: "not stated",
      source: "not stated",
    },
  },
  {
    name: "tiiny.host",
    answers: {
      private: "yes",
      own: "no",
      signup: "no",
      free: "partly",
      mcp: "yes",
      folders: "yes",
      samelink: "yes",
      rollback: "not stated",
      newlink: "not stated",
      bots: "not stated",
      source: "not stated",
    },
  },
  {
    name: "Pagecast",
    answers: {
      private: "no",
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
    },
  },
];
