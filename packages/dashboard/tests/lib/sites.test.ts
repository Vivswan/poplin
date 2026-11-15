// How a site's address is split for a screen: what every row shares, the site's own part, and the id that is left out.

import { describe, expect, test } from "bun:test";

import { addressParts } from "../../src/lib/sites";

describe("an address of a site", () => {
  // Drift: a private site's id would be drawn in clear though it is the key once the site is unlisted; an address with another install's id would be drawn whole; or a public name would be cut for an id it does not hold.
  test.each([
    [
      "a private site under a path",
      "http://127.0.0.1:4400/served/checkout--gsuy7p0swkhw-p-poplin/",
      ["127.0.0.1:4400/served/", "checkout--", "gsuy7p0swkhw", "-p-poplin"],
    ],
    [
      "an unlisted site under a path",
      "http://127.0.0.1:4400/served/pricing--gsuy7p0swkhw-u-poplin/",
      ["127.0.0.1:4400/served/", "pricing--", "gsuy7p0swkhw", "-u-poplin"],
    ],
    [
      "a private site on a host of its own",
      "https://checkout--gsuy7p0swkhw-p-poplin.example.com/",
      ["", "checkout--", "gsuy7p0swkhw", "-p-poplin.example.com"],
    ],
    ["a site by its id alone", "https://gsuy7p0swkhw-u-poplin.example.com/", ["", "", "gsuy7p0swkhw", "-u-poplin.example.com"]],
    [
      "a site's address on another install, whose id is not this install's",
      "https://pricing--k3v9x2m7q1zt-u-poplin.example.com/",
      ["", "pricing--", "k3v9x2m7q1zt", "-u-poplin.example.com"],
    ],
    ["a public name, which holds no id", "https://lisbon.example.com/", ["", "lisbon.example.com", "", ""]],
    ["a public name on a domain with two dashes of its own", "https://lisbon-page.customer--prod.example.com/", ["", "lisbon-page.customer--prod.example.com", "", ""]],
    ["a public name under a path", "http://127.0.0.1:4400/served/lisbon-page/", ["127.0.0.1:4400/served/", "lisbon-page", "", ""]],
  ])("%s is split into what rows share, its own part, its id, and the rest", (_what, address, parts) => {
    const { shared, before, hidden, after } = addressParts(address, "gsuy7p0swkhw");

    expect([shared, before, hidden, after]).toEqual(parts);
  });
});
