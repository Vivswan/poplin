// What an install knows of the newest released poplin: the release it last learned of, and when it last asked.

import * as v from "valibot";

import { MOMENT } from "./fields";

/** A released version: three whole numbers with dots between them, such as `0.2.0`. A version of any other form is compared with nothing. */
export const PLAIN_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The longest address of release notes that is kept. */
const MOST_NOTES_LENGTH = 300;

/** A release: its version, the UTC date it came out, the address of its notes, and whether updating to it changes the database. */
export const UPDATE_NEWS = v.strictObject({
  version: v.pipe(v.string(), v.regex(PLAIN_VERSION)),
  released: v.pipe(v.string(), v.isoDate()),
  notes: v.pipe(v.string(), v.maxLength(MOST_NOTES_LENGTH), v.startsWith("https://"), v.url()),
  database: v.boolean(),
});

/** The last time the install asked for the newest release, and the newest it has learned of; `null` while no release is known. */
export const UPDATE_CHECK = v.strictObject({ checked_at: MOMENT, news: v.nullable(UPDATE_NEWS) });

/** A release, as the install keeps it. */
export type UpdateNews = v.InferOutput<typeof UPDATE_NEWS>;

/** When the install last asked, and what it knows. */
export type UpdateCheck = v.InferOutput<typeof UPDATE_CHECK>;
