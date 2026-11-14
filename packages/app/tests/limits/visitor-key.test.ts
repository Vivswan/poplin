import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { visitorKey } from "../../src/limits/visitor-key";

const SECRET_TEXT = "a test secret, never a real one";
const NOON = Date.UTC(2026, 10, 13, 12);
const DAY = 86_400_000;

function importSecret(text: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(text), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function keyOf(address: string | undefined, now: number = NOON, secretText: string = SECRET_TEXT): Promise<string> {
  return visitorKey(address, await importSecret(secretText), now);
}

describe("visitorKey", () => {
  const sameVisitor: readonly { readonly name: string; readonly addresses: readonly (string | undefined)[] }[] = [
    { name: "an IPv4 address, however it is padded", addresses: ["192.0.2.7", " 192.0.2.7 "] },
    {
      name: "every address of one IPv6 /64",
      addresses: ["2001:db8:1:2::1", "2001:db8:1:2:ffff:ffff:ffff:ffff", "2001:0DB8:0001:0002:0000:0000:0000:0009", "2001:db8:1:2::"],
    },
    { name: "a /64 written with and without its zeros", addresses: ["2001:db8::1", "2001:db8:0:0:5::", "2001:db8:0:0:0:0:192.0.2.1"] },
    {
      name: "an IPv4 address and the same address inside an IPv6 one",
      addresses: ["192.0.2.7", "::ffff:192.0.2.7", "::ffff:c000:207", "0:0:0:0:0:FFFF:192.0.2.7"],
    },
    {
      name: "a missing address and text that is no address: they share one count, so neither is a way around the limit",
      addresses: [
        undefined,
        "",
        "unknown",
        "192.0.2.256",
        "2001:db8::1::2",
        "2001:db8:1:2:3:4:5:6:7",
        "2001:db8:1:2:3:4:5",
        "2001:db8::g",
        "12345::",
        "::1:2:3:4:5:6:7:8",
        "192.0.2.7, 198.51.100.1",
      ],
    },
  ];

  // Drift: a visitor who could change the key by respelling or renumbering inside their own network would reset their minute at will.
  test.each(sameVisitor)("$name is one visitor", async ({ addresses }) => {
    const keys = await Promise.all(addresses.map((address) => keyOf(address)));

    expect(new Set(keys).size).toBe(1);
  });

  // Drift: two networks under one key would have one visitor's requests refuse another's.
  test("different networks, another day, and another secret each give a different key", async () => {
    const keys = await Promise.all([
      keyOf("192.0.2.7"),
      keyOf("192.0.2.8"),
      keyOf("2001:db8:1:2::1"),
      keyOf("2001:db8:1:3::1"),
      keyOf("::1"),
      keyOf("64:ff9b::192.0.2.7"),
      keyOf(undefined),
      keyOf("192.0.2.7", NOON + DAY),
      keyOf("192.0.2.7", NOON, "another test secret"),
    ]);

    expect(new Set(keys).size).toBe(keys.length);
  });

  // Drift: the key is handed to a counter outside the Worker; anything but a keyed hash of the day and the network there would be an address kept.
  test("the key is the first 16 bytes of HMAC-SHA-256 over the UTC day and the network, and holds no part of the address", async () => {
    const expected = (network: string, day: string): string => createHmac("sha256", SECRET_TEXT).update(`${day}\n${network}`).digest("hex").slice(0, 32);

    expect([
      await keyOf("192.0.2.7"),
      await keyOf("2001:db8:1:2:3:4:5:6"),
      await keyOf(undefined),
      await keyOf("192.0.2.7", NOON + DAY / 2 - 1),
      await keyOf("192.0.2.7", NOON + DAY / 2),
    ]).toEqual([
      expected("192.0.2.7", "2026-11-13"),
      expected("2001:db8:1:2::/64", "2026-11-13"),
      expected("unknown", "2026-11-13"),
      expected("192.0.2.7", "2026-11-13"),
      expected("192.0.2.7", "2026-11-14"),
    ]);
  });
});
