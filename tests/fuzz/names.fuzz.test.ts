// Hostname labels and entry names arrive from the internet: the name parsers must refuse, never throw, and never accept a name the published rule forbids.

import { expect } from "bun:test";
import fc from "fast-check";

import { type AccessLetter, keptPublicNames, letterOf, parsePublicWord, publicHostLabel, readHostLabel, siteHostLabel } from "../../packages/core/src/names/marker";
import { nameFromEntry, parsePublicName, parseSiteName } from "../../packages/core/src/names/names";
import { parseSiteId } from "../../packages/core/src/sites/ids";
import { siteLabel, siteReference, splitLabel } from "../../packages/core/src/sites/labels";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const KEPT_NAME = "docs-p";
const RESERVED: ReadonlySet<string> = new Set([KEPT_NAME]);
const MIN_PUBLISHED_LENGTH = 3;
const MAX_PUBLISHED_LENGTH = 40;
const MAX_DNS_LABEL_LENGTH = 63;
const DNS_LABEL_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const PUBLISHED_WORD_SHAPE = /^[a-z]{2,9}$/;
const LABEL_ADDRESS_ENDING = /-[pu]-poplin$/;
const PUBLISHED_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PUBLISHED_ID = /^[0-9a-z]{12}$/;
const ENCODED_FORM_AT = 2;

const property = fuzzTarget(import.meta.file);

const wellFormed = fc
  .oneof(fc.array(fc.stringMatching(/^[a-z0-9]{1,10}$/), { minLength: 1, maxLength: 6 }), fc.array(fc.stringMatching(/^[a-z0-9]{40}$/), { minLength: 1, maxLength: 1 }))
  .map((words) => words.join("-"))
  .filter((name) => name.length >= MIN_PUBLISHED_LENGTH && name.length <= MAX_PUBLISHED_LENGTH);

const siteNames = wellFormed
  .map((name) => parseSiteName(name))
  .filter((parsed) => parsed.ok)
  .map((parsed) => parsed.value);

const publicNames = wellFormed
  .map((name) => parsePublicName(name, RESERVED))
  .filter((parsed) => parsed.ok)
  .map((parsed) => parsed.value);

const siteIds = fc
  .stringMatching(PUBLISHED_ID)
  .map((raw) => parseSiteId(raw))
  .filter((parsed) => parsed.ok)
  .map((parsed) => parsed.value);
const siteLabels = fc.tuple(wellFormed, fc.stringMatching(PUBLISHED_ID)).map(([name, id]) => `${name}--${id}`);
const rawWords = hostile(fc.oneof(fc.constantFrom("page", "poplin", "", "p", "my-page", "-page", "page2"), fc.stringMatching(/^[a-z0-9-]{0,12}$/)));
const endings = fc.constantFrom("-poplin", "-p-poplin", "-u-poplin", "-x-poplin", "-page", "-p-page", "-p", "-u", "--site");
const labels = hostile(fc.oneof(wellFormed, siteLabels, fc.stringMatching(PUBLISHED_ID), fc.tuple(fc.oneof(wellFormed, siteLabels, fc.stringMatching(PUBLISHED_ID)), endings).map(([site, ending]) => `${site}${ending}`)));
const entries = hostile(fc.oneof(wellFormed, wellFormed.map((name) => `${name}.html`)));

const publicWords = fc
  .oneof(fc.constantFrom("page", "poplin"), fc.stringMatching(PUBLISHED_WORD_SHAPE))
  .map((raw) => parsePublicWord(raw))
  .filter((word) => word !== undefined);
const layouts = publicWords.map((publicWord) => ({ publicWord, reserved: keptPublicNames(publicWord) }));
const accesses = fc.constantFrom("private" as const, "unlisted" as const, "public" as const);
const letters = fc.constantFrom<AccessLetter>("p", "u");

function followsPublishedRule(name: string): boolean {
  return name.length >= MIN_PUBLISHED_LENGTH && name.length <= MAX_PUBLISHED_LENGTH && PUBLISHED_SHAPE.test(name);
}

property(
  "a hostile public word is refused, not thrown on, unless it is 2 to 9 lowercase letters, and an accepted one is the string that came in",
  fc.property(rawWords, (raw) => {
    expect<unknown>(parsePublicWord(raw)).toBe(PUBLISHED_WORD_SHAPE.test(raw) ? raw : undefined);
  }),
);

property(
  "the address of any site under either letter, and of any public name under any public word, is a hostname label of at most 63 characters without two dashes third and fourth, so DNS and URL parsers carry it",
  fc.property(publicWords, siteNames, siteIds, publicNames, letters, (publicWord, name, id, publicName, letter) => {
    for (const label of [siteHostLabel(siteLabel(name, id), letter), siteHostLabel(id, letter), publicHostLabel(publicName, publicWord)]) {
      expect(label.length).toBeLessThanOrEqual(MAX_DNS_LABEL_LENGTH);
      expect(label).toMatch(DNS_LABEL_SHAPE);
      expect(label.startsWith("--", ENCODED_FORM_AT)).toBe(false);
    }
  }),
);

property(
  "a hostile label or entry is refused, not thrown on, under any public word",
  fc.property(labels, layouts, (label, layout) => {
    parseSiteName(label);
    nameFromEntry(label);
    parsePublicName(label, layout.reserved);
    parseSiteId(label);
    splitLabel(label, layout.reserved);
    siteReference(label);
    readHostLabel(label, layout);
  }),
);

property(
  "every accepted name follows the published rule, no accepted public name is one the layout keeps, and every accepted id is 12 base36 characters, so no site gets an address DNS cannot carry or the install answers on itself",
  fc.property(labels, layouts, (raw, layout) => {
    const checked = [parseSiteName(raw), nameFromEntry(raw), parsePublicName(raw, layout.reserved), splitLabel(raw, layout.reserved), siteReference(raw)];
    const accepted: readonly unknown[] = [...checked.map((outcome) => (outcome.ok ? outcome.value : undefined)), readHostLabel(raw, layout)];
    const parts = accepted
      .filter((value) => value !== undefined)
      .map((value): { readonly kind?: string; readonly name?: string; readonly id?: string } => (typeof value === "string" ? { name: value } : (value as object)));
    const names = parts.map((part) => part.name).filter((name) => name !== undefined);
    const addressed = [splitLabel(raw, layout.reserved), { ok: true as const, value: readHostLabel(raw, layout) }].map((outcome) => (outcome.ok && outcome.value.kind === "public-name" ? outcome.value.name : undefined));
    const publicOnes = [parsePublicName(raw, layout.reserved).ok ? raw : undefined, ...addressed].filter((name) => name !== undefined);
    const ids = parts.map((part) => part.id).filter((id) => id !== undefined);

    expect(names.filter((name) => !followsPublishedRule(name))).toEqual([]);
    expect(publicOnes.filter((name) => layout.reserved.has(name))).toEqual([]);
    expect(ids.filter((id) => !PUBLISHED_ID.test(id))).toEqual([]);
  }),
);

property(
  "every well formed name is accepted as a name, and as a public name unless the layout keeps it, so a tightened rule cannot orphan published sites",
  fc.property(fc.oneof(wellFormed, fc.constant(KEPT_NAME)), (name) => {
    expect([parseSiteName(name).ok, parsePublicName(name, RESERVED).ok]).toEqual([true, name !== KEPT_NAME]);
  }),
);

property(
  "any name, id, and access writes a label address that reads back as the same site and the letter of that access, the id alone reads back as the id, and a public address as its public name, under any public word",
  fc.property(siteNames, siteIds, publicNames, accesses, layouts, fc.context(), (name, id, publicName, access, layout, context) => {
    const letter = letterOf(access);
    const address = siteHostLabel(siteLabel(name, id), letter);
    context.log(`address: ${address}`);

    expect(letter === "p").toBe(access === "private");
    expect<unknown>(readHostLabel(address, layout)).toEqual({ kind: "site", name, id, letter });
    expect<unknown>(readHostLabel(siteHostLabel(id, letter), layout)).toEqual({ kind: "site", id, letter });

    if (layout.reserved.has(publicName)) return;

    expect<unknown>(readHostLabel(publicHostLabel(publicName, layout.publicWord), layout)).toEqual({ kind: "public-name", name: publicName });
  }),
);

property(
  "no public address ends in -p-poplin or -u-poplin or reads as a label address, under any public word, so no public site sits behind the private login or takes the address of an id",
  fc.property(labels, layouts, (raw, layout) => {
    const publicName = parsePublicName(raw, layout.reserved);
    if (!publicName.ok) return;

    const address = publicHostLabel(publicName.value, layout.publicWord);

    expect(address).not.toMatch(LABEL_ADDRESS_ENDING);
    expect<unknown>(readHostLabel(address, layout)).toEqual({ kind: "public-name", name: publicName.value });
  }),
);

property(
  "an accepted label is exactly its name, or its name, two dashes, and its id, so no extra text rides along to another site",
  fc.property(labels, (label) => {
    const split = splitLabel(label, RESERVED);
    if (!split.ok) return;

    const rebuilt = split.value.kind === "site" ? `${split.value.name}--${split.value.id}` : split.value.name;

    expect(rebuilt).toBe(label);
    expect(label.includes("--")).toBe(split.value.kind === "site");
  }),
);

property(
  "a reference a command accepts is exactly what was typed, be it an id alone, a label, or a name, and twelve base36 characters are always the id",
  fc.property(labels, (raw) => {
    const reference = siteReference(raw);
    if (!reference.ok) return;

    const parts: { readonly name?: string; readonly id?: string } = reference.value;

    expect([parts.name, parts.id].filter((part) => part !== undefined).join("--")).toBe(raw);
    expect(reference.value.kind === "id").toBe(PUBLISHED_ID.test(raw));
  }),
);

property(
  "an ordinary file or folder name in any ASCII case, with or without .html, derives its lowercase name, so one call still publishes it",
  fc.property(fc.mixedCase(fc.tuple(wellFormed, fc.constantFrom("", ".html")).map(([name, suffix]) => `${name}${suffix}`)), (entry) => {
    const name = entry.toLowerCase().replace(/\.html$/, "");

    expect<unknown>(nameFromEntry(entry)).toEqual({ ok: true, value: name });
  }),
);

property(
  "a name derived from an entry is one the parser accepts and differs from the entry only by ASCII case and a trailing .html",
  fc.property(entries, (entry) => {
    const derived = nameFromEntry(entry);
    if (!derived.ok) return;

    expect(parseSiteName(derived.value)).toEqual(derived);
    expect(entry).toMatch(/^[\x21-\x7e]+$/);
    expect([derived.value, `${derived.value}.html`]).toContain(entry.toLowerCase());
  }),
);
