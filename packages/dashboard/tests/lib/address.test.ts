// The console's rules for an address: how a query is read from it and written into it.

import "./support/page";

import { describe, expect, test } from "bun:test";

import { ADDRESS_RULES } from "@/lib/address";

describe("the query of an address", () => {
  // Drift: the router's own rules write a value as JSON, so `?code=ABCD-1234` would be read as text but `?after=12` as a number, and a link shared before would name another page.
  test.each([
    ["a terminal's code", "?code=ABCD-1234", { code: "ABCD-1234" }],
    ["digits stay text", "?after=12&q=true", { after: "12", q: "true" }],
    ["a space and a mark", "?q=a+b%26c", { q: "a b&c" }],
    ["a key named twice keeps its first value", "?q=one&q=two", { q: "one" }],
    ["no query", "", {}],
  ])("reads %s as plain text", (_name, text, search) => {
    expect(ADDRESS_RULES.parseSearch(text)).toEqual(search);
  });

  // Drift: a value would be written in quotes (`?q=%22a%22`), or a cleared search would stay in the address as `?q=`.
  test.each([
    ["plain values", { sort: "name", dir: "desc" }, "?sort=name&dir=desc"],
    ["a space and a mark", { q: "a b&c" }, "?q=a+b%26c"],
    ["an empty value is left out", { q: "", access: "public" }, "?access=public"],
    ["nothing", {}, ""],
  ])("writes %s as the address holds them", (_name, search, text) => {
    expect(ADDRESS_RULES.stringifySearch(search)).toBe(text);
  });
});
