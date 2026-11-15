// The shape of `built-client.js`, the module `scripts/built-client.ts` writes before the Worker is bundled. No commit holds that module; this file is what a typecheck reads in its place.

/** One built file of the dashboard's client: its media type, and its content as text, or as base64 when it is no text. */
type ClientFile = { readonly type: string; readonly text: string } | { readonly type: string; readonly base64: string };

/** The dashboard's client as its build wrote it. */
export declare const CLIENT: {
  /** The names of the script and the stylesheet the page loads. */
  readonly entry: { readonly script: string; readonly style: string };

  /** Every file, by its name, which holds a hash of the file's content. */
  readonly files: Readonly<Record<string, ClientFile>>;
};
