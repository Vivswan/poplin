// A route's query, read by the schema its action takes. The address holds text alone, so a number and a switch are read from their text first, and an object from the keys that start with its name.

import type { Handler } from "hono";
import type { BlankEnv } from "hono/types";
import { validator } from "hono/validator";
import * as v from "valibot";

import { WHOLE_PATTERN } from "./body";
import { refusal } from "./respond";

/** A whole number as a query gives it. */
const WHOLE = v.pipe(v.string(), v.regex(WHOLE_PATTERN), v.toNumber());

/** A switch as a query gives it: `true` or `false`. */
const SWITCH = v.pipe(v.picklist(["true", "false"]), v.parseBoolean());

/** What reads the text of a value, by the type the action's schema takes it as. A type missing here is taken as the text itself. */
const READERS: Readonly<Record<string, v.GenericSchema>> = { number: WHOLE, boolean: SWITCH };

/** The schema of what an action takes from a query: an object that allows no key beyond its own. */
export type QuerySchema = v.StrictObjectSchema<v.ObjectEntries, undefined>;

/** The keys an address may hold for what a schema takes: a key of its own, or one a part for a key that holds an object, as `after_id`. */
type KeysOf<Taken> = { [Key in keyof Taken & string]: NonNullable<Taken[Key]> extends string | number | boolean ? Key : `${Key}_${keyof NonNullable<Taken[Key]> & string}` }[keyof Taken & string];

/** The keys of what a schema takes that a request must hold. */
type NeededOf<Taken> = { [Key in keyof Taken]-?: undefined extends Taken[Key] ? never : Key }[keyof Taken];

/** The query a client is typed to send for what a schema takes: text under each key, and a key the schema needs is needed. */
type QueryText<Taken> = { readonly [Key in KeysOf<Pick<Taken, NeededOf<Taken>>>]: string } & { readonly [Key in KeysOf<Omit<Taken, NeededOf<Taken>>>]?: string };

/** What a client is typed to send: a query that may be left out where the schema needs no key. */
type Sending<Taken> = [NeededOf<Taken>] extends [never] ? { query?: QueryText<Taken> } : { query: QueryText<Taken> };

/** The middleware that checks a query by a schema, typed by what a client sends and what the handler is handed. */
type Queried<Schema extends QuerySchema> = Handler<BlankEnv, string, { in: Sending<v.InferInput<Schema>>; out: { query: v.InferOutput<Schema> } }>;

/** The schema a value is checked by first, under what makes it optional and what checks it further. */
function baseOf(schema: v.GenericSchema): v.GenericSchema {
  if ("wrapped" in schema) return baseOf(schema.wrapped as v.GenericSchema);

  if ("pipe" in schema) return baseOf((schema.pipe as readonly [v.GenericSchema])[0]);

  return schema;
}

/** The keys an address may hold for a schema's entries, each with what reads its text. A value of an object `after` is held as one key a part: `after_id`. */
function textEntries(entries: v.ObjectEntries, prefix = ""): Record<string, v.GenericSchema> {
  const flat: Record<string, v.GenericSchema> = {};

  for (const [key, entry] of Object.entries(entries)) {
    const base = baseOf(entry as v.GenericSchema);

    if ("entries" in base) {
      Object.assign(flat, textEntries(base.entries as v.ObjectEntries, `${prefix}${key}_`));
    } else {
      flat[`${prefix}${key}`] = v.optional(READERS[base.type] ?? v.string());
    }
  }

  return flat;
}

/** The values an address held, in the form of a schema's entries: the parts of an object gathered under its key, and no object where no part was given. */
function gathered(entries: v.ObjectEntries, values: Readonly<Record<string, unknown>>, prefix = ""): Record<string, unknown> {
  const asked: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(entries)) {
    const base = baseOf(entry as v.GenericSchema);
    const value = "entries" in base ? gathered(base.entries as v.ObjectEntries, values, `${prefix}${key}_`) : values[`${prefix}${key}`];
    const given = "entries" in base ? Object.keys(value as object).length > 0 : value !== undefined;

    if (given) asked[key] = value;
  }

  return asked;
}

/** What an address holds after its `?`, as the platform reads it: one text a key, and every text of a key given more than once. */
function textOf(address: string): Record<string, string | string[]> {
  const given = new URL(address).searchParams;
  const keys = [...new Set(given.keys())];

  // `fromEntries` keeps a key such as `__proto__` as a key of the record, where an assignment would drop it.
  return Object.fromEntries(
    keys.map((key) => {
      const all = given.getAll(key);

      return [key, all.length === 1 ? all.join("") : all];
    }),
  );
}

/** The key of the address a refused value sits under; `query` for a key no route names. */
function aboutOf(issue: v.BaseIssue<unknown>): string {
  if (issue.expected === "never") return "query";

  return v.getDotPath(issue)?.replaceAll(".", "_") ?? "query";
}

/**
 * Check a request's query against the schema its action takes, before the route's handler runs.
 *
 * @param schema - what the action takes; a route that takes no query is given an object without entries
 * @returns the middleware, which hands the handler the checked value as `valid("query")`, or answers `bad_argument` about the key of the address that is given twice or is not of its form, and about `query` for a key the schema does not name
 */
export function queried<Schema extends QuerySchema>(schema: Schema): Queried<Schema> {
  const text = v.pipe(
    v.strictObject(textEntries(schema.entries)),
    v.transform((values) => gathered(schema.entries, values)),
    schema as QuerySchema,
  );

  // The platform reads the address, not the framework: the framework drops a value under no key and keeps text that is no UTF-8 as it was sent.
  return validator("query", (_parsed, context) => {
    const asked = v.safeParse(text, textOf(context.req.url));

    return asked.success ? asked.output : refusal("bad_argument", aboutOf(asked.issues[0]));
  }) as Queried<Schema>;
}
