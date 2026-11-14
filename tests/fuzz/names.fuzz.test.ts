// Hostname labels and entry names arrive from the internet: the name parsers must refuse, never throw, and never accept a name the published rule forbids.

import { expect } from "bun:test";
import fc from "fast-check";

import { nameFromEntry, parseSiteName, type SiteName, secretName, splitLabel } from "../../packages/core/src/names/names";
import { applyPrefix, stripPrefix } from "../../packages/core/src/names/prefix";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const NO_RESERVED: ReadonlySet<string> = new Set();
const MAX_PUBLISHED_LENGTH = 40;
const PUBLISHED_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PUBLISHED_SECRET = /^[0-9a-z]{12}$/;

const property = fuzzTarget(import.meta.file);

const wellFormed = fc
  .oneof(fc.array(fc.stringMatching(/^[a-z0-9]{1,10}$/), { minLength: 1, maxLength: 6 }), fc.array(fc.stringMatching(/^[a-z0-9]{40}$/), { minLength: 1, maxLength: 1 }))
  .map((words) => words.join("-"))
  .filter((name) => name.length <= MAX_PUBLISHED_LENGTH);

const siteNames = wellFormed
  .map((name) => parseSiteName(name, NO_RESERVED))
  .filter((parsed) => parsed.ok)
  .map((parsed) => parsed.value);

const reservedSets = fc.uniqueArray(fc.oneof(fc.constantFrom("www", "admin", "index"), wellFormed), { maxLength: 4 }).map((names): ReadonlySet<string> => new Set(names));
const secretLabels = fc.tuple(wellFormed, fc.stringMatching(PUBLISHED_SECRET)).map(([name, secret]) => `${name}--${secret}`);
const labels = hostile(fc.oneof(wellFormed, secretLabels, fc.tuple(fc.constantFrom("page-", "p", "site--"), wellFormed).map(([prefix, name]) => `${prefix}${name}`)));
const entries = hostile(fc.oneof(wellFormed, wellFormed.map((name) => `${name}.html`)));
const prefixes = hostile(fc.constantFrom("page-", "", "p", "site--"));

function followsPublishedRule(name: string): boolean {
  return name.length >= 1 && name.length <= MAX_PUBLISHED_LENGTH && PUBLISHED_SHAPE.test(name);
}

function without(reserved: ReadonlySet<string>, name: string): ReadonlySet<string> {
  return new Set([...reserved].filter((kept) => kept !== name));
}

property(
  "a hostile label, entry, or prefix is refused, not thrown on, and a stripped label put back behind its prefix is the label that came in",
  fc.property(labels, prefixes, reservedSets, (label, prefix, reserved) => {
    parseSiteName(label, reserved);
    nameFromEntry(label, reserved);
    splitLabel(label, reserved);

    const stripped = stripPrefix(prefix, label);
    if (stripped.ok) expect(`${prefix}${stripped.label}`).toBe(label);
  }),
);

property(
  "every accepted name follows the published rule and is not reserved, so no site gets a name DNS or the bucket cannot carry",
  fc.property(labels, reservedSets, (raw, reserved) => {
    const outcomes = [parseSiteName(raw, reserved), nameFromEntry(raw, reserved), splitLabel(raw, reserved)];
    const accepted = outcomes.map((outcome) => (outcome.ok ? outcome.value : undefined)).filter((value) => value !== undefined);
    const names = accepted.map((value) => (typeof value === "string" ? value : value.name));

    expect(names.filter((name) => !followsPublishedRule(name) || reserved.has(name))).toEqual([]);
  }),
);

property(
  "every well formed name is accepted unless reserved, so a tightened rule cannot orphan published sites",
  fc.property(wellFormed, reservedSets, (name, reserved) => {
    expect(parseSiteName(name, reserved).ok).toBe(!reserved.has(name));
  }),
);

property(
  "a secret address built under any prefix reads back as its site and a 12 character base36 secret",
  fc.property(siteNames, prefixes, reservedSets, fc.context(), (name, prefix, reserved, context) => {
    const address = applyPrefix(prefix, secretName(name));
    const stripped = stripPrefix(prefix, address);
    const label = stripped.ok ? stripped.label : undefined;
    context.log(`address: ${address}`);

    expect(label).toBeString();
    expect<unknown>(splitLabel(label as string, without(reserved, name))).toEqual({ ok: true, value: { name, secret: expect.stringMatching(PUBLISHED_SECRET) } });
  }),
);

property(
  "an accepted label is exactly its name, or its name, two dashes, and its secret, so no extra text rides along to another site",
  fc.property(labels, reservedSets, (label, reserved) => {
    const split = splitLabel(label, reserved);
    if (!split.ok) return;

    const parts: { readonly name: SiteName; readonly secret?: string } = split.value;
    const rebuilt = parts.secret === undefined ? parts.name : `${parts.name}--${parts.secret}`;

    expect(rebuilt).toBe(label);
    if (parts.secret !== undefined) expect(parts.secret).toMatch(PUBLISHED_SECRET);
  }),
);

property(
  "a label names the same site whatever else is reserved, so reserving a name cannot repoint an address",
  fc.property(labels, reservedSets, reservedSets, (label, reserved, others) => {
    const split = splitLabel(label, reserved);
    if (!split.ok) return;

    expect(splitLabel(label, without(others, split.value.name))).toEqual(split);
  }),
);

property(
  "an ordinary file or folder name in any ASCII case, with or without .html, derives its lowercase name, so one call still publishes it",
  fc.property(fc.mixedCase(fc.tuple(wellFormed, fc.constantFrom("", ".html")).map(([name, suffix]) => `${name}${suffix}`)), (entry) => {
    const name = entry.toLowerCase().replace(/\.html$/, "");

    expect<unknown>(nameFromEntry(entry, NO_RESERVED)).toEqual({ ok: true, value: name });
  }),
);

property(
  "a name derived from an entry is one the parser accepts and differs from the entry only by ASCII case and a trailing .html",
  fc.property(entries, reservedSets, (entry, reserved) => {
    const derived = nameFromEntry(entry, reserved);
    if (!derived.ok) return;

    expect(parseSiteName(derived.value, reserved)).toEqual(derived);
    expect(entry).toMatch(/^[\x21-\x7e]+$/);
    expect([derived.value, `${derived.value}.html`]).toContain(entry.toLowerCase());
  }),
);
