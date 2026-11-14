// Hostname labels and entry names arrive from the internet: the name parsers must refuse, never throw, and never accept a name the published rule forbids.

import { expect } from "bun:test";
import fc from "fast-check";

import { nameFromEntry, parsePublicName, parseSiteName } from "../../packages/core/src/names/names";
import { applySuffix, parseSuffix, readHostLabel, stripSuffix } from "../../packages/core/src/names/suffix";
import { parseSiteId } from "../../packages/core/src/sites/ids";
import { siteLabel, siteReference, splitLabel } from "../../packages/core/src/sites/labels";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const GALLERY_NAME = "gallery";
const MIN_PUBLISHED_LENGTH = 3;
const MAX_PUBLISHED_LENGTH = 40;
const MAX_DNS_LABEL_LENGTH = 63;
const MAX_PUBLISHED_SUFFIX_LENGTH = 9;
const DNS_LABEL_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const PUBLISHED_SUFFIX_SHAPE = /^(-[a-z0-9]+)+$/;
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
  .map((name) => parsePublicName(name))
  .filter((parsed) => parsed.ok)
  .map((parsed) => parsed.value);

const siteIds = fc
  .stringMatching(PUBLISHED_ID)
  .map((raw) => parseSiteId(raw))
  .filter((parsed) => parsed.ok)
  .map((parsed) => parsed.value);
const siteLabels = fc.tuple(wellFormed, fc.stringMatching(PUBLISHED_ID)).map(([name, id]) => `${name}--${id}`);
const rawSuffixes = hostile(fc.oneof(fc.constantFrom("-page", "", "-p", "-my-pages", "page-", "--page"), fc.stringMatching(/^[a-z0-9-]{0,12}$/)));
const labels = hostile(fc.oneof(wellFormed, siteLabels, fc.stringMatching(PUBLISHED_ID), fc.tuple(fc.oneof(wellFormed, siteLabels), fc.constantFrom("-page", "-p", "--site")).map(([site, suffix]) => `${site}${suffix}`)));
const entries = hostile(fc.oneof(wellFormed, wellFormed.map((name) => `${name}.html`)));

const suffixes = rawSuffixes
  .map((raw) => parseSuffix(raw))
  .filter((parsed) => parsed.ok)
  .map((parsed) => parsed.value);

function followsPublishedRule(name: string): boolean {
  return name.length >= MIN_PUBLISHED_LENGTH && name.length <= MAX_PUBLISHED_LENGTH && PUBLISHED_SHAPE.test(name);
}

function followsSuffixRule(raw: string): boolean {
  return raw.length <= MAX_PUBLISHED_SUFFIX_LENGTH && PUBLISHED_SUFFIX_SHAPE.test(raw);
}

property(
  "a hostile suffix is refused, not thrown on, unless it is a dash and then letters, digits, and single dashes, 9 characters at most, and an accepted one is the string that came in and reads back what it was put after",
  fc.property(rawSuffixes, siteNames, siteIds, publicNames, (raw, name, id, publicName) => {
    const parsed = parseSuffix(raw);

    expect(parsed.ok).toBe(followsSuffixRule(raw));
    if (!parsed.ok) return;

    const label = siteLabel(name, id);

    expect<string>(parsed.value).toBe(raw);
    expect<unknown>([stripSuffix(parsed.value, applySuffix(parsed.value, label)), stripSuffix(parsed.value, applySuffix(parsed.value, publicName))]).toEqual([
      { ok: true, label },
      { ok: true, label: publicName },
    ]);
  }),
);

property(
  "the address of any site under any accepted suffix is a hostname label of at most 63 characters without two dashes third and fourth, so no configured suffix makes an address DNS or a URL parser cannot carry",
  fc.property(suffixes, siteNames, siteIds, publicNames, (suffix, name, id, publicName) => {
    for (const label of [applySuffix(suffix, siteLabel(name, id)), applySuffix(suffix, publicName)]) {
      expect(label.length).toBeLessThanOrEqual(MAX_DNS_LABEL_LENGTH);
      expect(label).toMatch(DNS_LABEL_SHAPE);
      expect(label.startsWith("--", ENCODED_FORM_AT)).toBe(false);
    }
  }),
);

property(
  "a hostile label or entry is refused, not thrown on, and a stripped label put back before its suffix is the label that came in",
  fc.property(labels, suffixes, (label, suffix) => {
    parseSiteName(label);
    nameFromEntry(label);
    parsePublicName(label);
    parseSiteId(label);
    splitLabel(label);
    siteReference(label);
    readHostLabel(suffix, label);

    const stripped = stripSuffix(suffix, label);
    if (stripped.ok) expect(`${stripped.label}${suffix}`).toBe(label);
  }),
);

property(
  "every accepted name follows the published rule, no accepted public name is the one the gallery keeps, and every accepted id is 12 base36 characters, so no site gets an address DNS cannot carry or the install answers on itself",
  fc.property(labels, suffixes, (raw, suffix) => {
    const checked = [parseSiteName(raw), nameFromEntry(raw), parsePublicName(raw), splitLabel(raw), siteReference(raw)];
    const accepted: readonly unknown[] = [...checked.map((outcome) => (outcome.ok ? outcome.value : undefined)), readHostLabel(suffix, raw)];
    const parts = accepted
      .filter((value) => value !== undefined)
      .map((value): { readonly kind?: string; readonly name?: string; readonly id?: string } => (typeof value === "string" ? { name: value } : (value as object)));
    const names = parts.map((part) => part.name).filter((name) => name !== undefined);
    const publicOnes = [parsePublicName(raw).ok ? raw : undefined, ...parts.map((part) => (part.kind === "public-name" ? part.name : undefined))].filter((name) => name !== undefined);
    const ids = parts.map((part) => part.id).filter((id) => id !== undefined);

    expect(names.filter((name) => !followsPublishedRule(name))).toEqual([]);
    expect(publicOnes.filter((name) => name === GALLERY_NAME)).toEqual([]);
    expect(ids.filter((id) => !PUBLISHED_ID.test(id))).toEqual([]);
  }),
);

property(
  "every well formed name is accepted as a name, and as a public name unless the gallery keeps it, so a tightened rule cannot orphan published sites",
  fc.property(fc.oneof(wellFormed, fc.constant(GALLERY_NAME)), (name) => {
    expect([parseSiteName(name).ok, parsePublicName(name).ok]).toEqual([true, name !== GALLERY_NAME]);
  }),
);

property(
  "a site address built under any suffix reads back as its name and its id, and a public address as its public name",
  fc.property(siteNames, siteIds, publicNames, suffixes, fc.context(), (name, id, publicName, suffix, context) => {
    const address = applySuffix(suffix, siteLabel(name, id));
    context.log(`address: ${address}`);

    expect<unknown>(readHostLabel(suffix, address)).toEqual({ kind: "site", name, id });
    expect<unknown>(readHostLabel(suffix, applySuffix(suffix, publicName))).toEqual({ kind: "public-name", name: publicName });
  }),
);

property(
  "an accepted label is exactly its name, or its name, two dashes, and its id, so no extra text rides along to another site",
  fc.property(labels, (label) => {
    const split = splitLabel(label);
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
