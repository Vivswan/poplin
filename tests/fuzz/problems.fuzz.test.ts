// What is kept of a failure is copied into a bug report: whatever a message carries, nothing shaped like a token, an email, an address, or an id with a digit is left in it.
// `SHAPES` names each such shape by what gives it away.

import { expect } from "bun:test";
import fc from "fast-check";

import { problemDetail } from "../../packages/core/src/records/problem-detail";
import { fuzzTarget } from "./config";
import { hostile } from "./hostile";

const SHAPES: Readonly<Record<string, RegExp>> = {
  "a token or its id": /[0-9a-f]{16}/i,
  "an email": /@/,
  "an address": /:\/\/|::|[a-z0-9][.:/][a-z0-9]/i,
  "an id with a digit": /[a-z]\d|\d[a-z]/i,
  "a key and its value": /[=&%#\\<>]/,
};

const property = fuzzTarget(import.meta.file);

const hex = (length: number): fc.Arbitrary<string> => fc.string({ unit: fc.constantFrom(..."0123456789abcdef"), minLength: length, maxLength: length });
const names = fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/);
const tokens = fc.tuple(hex(16), hex(64)).map(([id, secret]) => `poplin_${id}_${secret}`);
const emails = fc.tuple(names, names).map(([who, where]) => `${who}@${where}.example.com`);
const addresses = fc.tuple(names, names, names).map(([host, path, value]) => `https://${host}.example.com/${path}?key=${value}&next=/${path}`);
const visitors = fc.oneof(fc.ipV4(), fc.ipV6());
const labels = fc.tuple(names, fc.stringMatching(/^[0-9a-z]{12}$/)).map(([name, id]) => `${name}--${id}`);
const words = fc.constantFrom("the", "store", "did", "not", "answer", "of", "failed", "day's", "(again)", "upload:", "503", "SQLITE_BUSY");
const values = hostile(fc.oneof(tokens, hex(16), emails, addresses, visitors, labels));
const messages = fc.array(fc.oneof(words, values), { maxLength: 30 }).map((parts) => parts.join(" "));

property(
  "no token, email, address, or id with a digit is left in what is kept of a failure, and it is never over 200 characters",
  fc.property(messages, fc.oneof(fc.constant("Error"), values), (message, name) => {
    const kept = problemDetail(Object.assign(new Error(message), { name }));
    const text = `${kept.name ?? ""} ${kept.message ?? ""}`;
    const left = Object.keys(SHAPES).filter((shape) => SHAPES[shape]?.test(text.replaceAll("...", " ")));

    expect([left, (kept.message ?? "").length <= 200]).toEqual([[], true]);
  }),
);

// Control: the property above would hold of a cleaner that kept nothing.
property(
  "a message of plain words is kept as it was written",
  fc.property(fc.array(words, { maxLength: 12 }), (parts) => {
    expect(problemDetail(new Error(["the", ...parts].join("  "))).message).toBe(["the", ...parts].join(" "));
  }),
);
