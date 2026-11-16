// The dashboard's client as the Worker hands it out: the files its build wrote, which ride inside the Worker's one file.

import type { ClientFiles } from "@poplin/app/src/console/shell";
import { base64ToUint8Array } from "uint8array-extras";

import { CLIENT } from "./built-client";

/** The dashboard's built client. */
export const CLIENT_FILES: ClientFiles = {
  entry: async () => CLIENT.entry,

  file: async (name) => {
    const file = Object.hasOwn(CLIENT.files, name) ? CLIENT.files[name] : undefined;
    if (file === undefined) return undefined;

    return "text" in file ? { body: file.text, type: file.type } : { body: new Uint8Array(base64ToUint8Array(file.base64)), type: file.type };
  },
};
