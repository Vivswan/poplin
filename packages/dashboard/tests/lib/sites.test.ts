// How a site's address is split for a screen: what every row shares, the site's own part, and the id that is left out. And how the address of one of its files is written.

import { describe, expect, test } from "bun:test";

import { addressParts, fileAddress } from "../../src/lib/sites";

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

describe("the address of a file of a site", () => {
  // Drift: a site decodes each part of a path once when it serves a file; a name written into the address as it stands would be cut at its `#` or `?`, read as an escape at its `%`, or leave the site where a part is a whole address.
  test.each([
    ["a site on a host of its own", "https://checkout--gsuy7p0swkhw-p-poplin.example.com", "assets/app.css", "https://checkout--gsuy7p0swkhw-p-poplin.example.com/assets/app.css"],
    ["a site under a path", "https://poplin-sites.example.net/pricing--gsuy7p0swkhw-u-poplin/", "index.html", "https://poplin-sites.example.net/pricing--gsuy7p0swkhw-u-poplin/index.html"],
    ["a name with a space, a hash, and a question mark", "https://lisbon.example.com/", "day 1/notes #2?.txt", "https://lisbon.example.com/day%201/notes%20%232%3F.txt"],
    ["a name with a percent sign", "https://lisbon.example.com/", "100%/50%25.css", "https://lisbon.example.com/100%25/50%2525.css"],
    ["a first part that reads as an address", "https://poplin-sites.example.net/lisbon-page/", "https:other.example.com/x", "https://poplin-sites.example.net/lisbon-page/https%3Aother.example.com/x"],
  ])("%s keeps every part of the path as a part of the address, under the site's own", (_what, address, path, written) => {
    const file = new URL(fileAddress(address, path));

    expect([file.href, file.pathname.split("/").slice(-path.split("/").length).map(decodeURIComponent).join("/")]).toEqual([written, path]);
  });
});
