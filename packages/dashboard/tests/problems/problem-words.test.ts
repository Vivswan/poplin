// What a problem tells a person to do, on the screen it is acted on and on every other one.

import { describe, expect, test } from "bun:test";

import { todoAt } from "@/problems/problem-words";

describe("what to do about a problem", () => {
  // Drift: the Domain screen would tell a person who is on it to "Open Domain" again, or another screen would lose the words that lead there.
  test.each([
    { todo: "Open Domain and press Check.", home: "domain", here: "domain", says: "Press Check." },
    { todo: "Open Domain and press Check.", home: "domain", here: "usage", says: "Open Domain and press Check." },
    { todo: "Open Domain and press Check.", home: "domain", here: undefined, says: "Open Domain and press Check." },
    { todo: "Try again.", home: "usage", here: "usage", says: "Try again." },
    { todo: "Raise it under Open Settings and more.", home: "settings", here: "settings", says: "Raise it under Open Settings and more." },
  ] as const)("$todo, acted on $home and said on $here, reads $says", ({ todo, home, here, says }) => {
    expect(todoAt({ todo, home }, here)).toBe(says);
  });
});
