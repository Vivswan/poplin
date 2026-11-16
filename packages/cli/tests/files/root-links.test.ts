import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { PublishFile } from "../../src/files/read";
import { readFiles } from "../../src/files/read";
import { firstRootLink } from "../../src/files/root-links";

const ENCODER = new TextEncoder();
const HOSTS = ["sites.example.net", "private.example.net"];

/** A file of a listing that hands its text over in the given pieces, one piece a read. */
function file(path: string, ...pieces: readonly string[]): PublishFile {
  const chunks = pieces.map((piece) => ENCODER.encode(piece));

  return {
    path,
    size: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    contentType: "text/html",
    open: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);

          controller.close();
        },
      }),
  };
}

describe("firstRootLink", () => {
  // Drift: a browser, not this repository, decides where a link leads. Under https://sites.example.net/report--k3f9x2ab71qz/ only a value that starts with one "/" leaves the site for the host's root.
  test.each<[string, string, string | undefined]>([
    ["a path from the root", "/css/site.css", "/css/site.css"],
    ["the root alone", "/", "/"],
    ["a path from the root with a query", "/search?q=1#top", "/search?q=1#top"],
    ["a path from the root inside whitespace", " \n/a.html\t", "/a.html"],
    ["another host, with the page's scheme", "//cdn.example.com/site.css", undefined],
    ["a place on the page", "#top", undefined],
    ["an address with a scheme", "https://example.com/a", undefined],
    ["a mail address", "mailto:ada@example.com", undefined],
    ["a file beside the page", "assets/app.js", undefined],
    ["a file beside the page, with a dot", "./a.html", undefined],
    ["a file one folder up", "../a.html", undefined],
    ["a query alone", "?page=2", undefined],
    ["nothing", "", undefined],
  ])("an href that is %s (%j) is a root link or none: %j", async (_name, value, link) => {
    const found = await firstRootLink([file("index.html", `<a href="${value}">x</a>`)], HOSTS);

    expect(found).toEqual(link === undefined ? undefined : { file: "index.html", link });
  });

  // Drift: what counts as a link is HTML's to say; a page read as text, or by a pattern, would take a script's string for a link and miss a tag in capitals.
  test.each<[string, string, string | undefined]>([
    ["a src", '<script src="/app.js"></script>', "/app.js"],
    ["capital tags and attributes", '<IMG SRC="/Logo.png">', "/Logo.png"],
    ["a value without quotes", "<link rel=stylesheet href=/site.css>", "/site.css"],
    ["the first of two attributes of one tag", '<img src="/a.png" srcset="/b.png 2x">', "/a.png"],
    ["the first of two tags", '<a href="b.html">b</a><a href="/c.html">c</a><a href="/d.html">d</a>', "/c.html"],
    ["a srcset whose second candidate starts at the root", '<img srcset="a.png 1x, /b.png 2x, /c.png 3x">', "/b.png"],
    ["a srcset whose first candidate ends in a comma", '<source srcset="a.png, /b.png 2x">', "/b.png"],
    ["a srcset with a comma inside one address, which HTML reads as that address's own", '<source srcset="a.png,/b.png 2x">', undefined],
    ["a srcset of files beside the page", '<img srcset="a.png 1x, img/b.png 2x">', undefined],
    ["a srcset whose data address holds a comma and then a slash", '<img srcset="data:image/jpeg;base64,/9j/4AAQ 1x, b.png 2x">', undefined],
    ["a link in a script's text", '<script>const page = \'<a href="/x">\';</script>', undefined],
    ["a link in a comment", '<!-- <a href="/x"> -->', undefined],
    ["a link in the page's text", "&lt;a href=&quot;/x&quot;&gt;", undefined],
    ["an attribute that is not read", '<form action="/send"><video poster="/p.png"></video><object data="/o.pdf"></object></form>', undefined],
    ["a base that starts at the root", '<base href="/docs/"><a href="a.html">a</a>', "/docs/"],
    ["a base beside the page, which leaves a root link at the root", '<base href="docs/"><a href="/a.html">a</a>', "/a.html"],
    ["a base on another host, which takes the root links with it", '<base href="https://cdn.example.com/"><a href="/a.html">a</a>', undefined],
    ["a base on another host with the page's scheme", '<base href="//cdn.example.com/"><img src="/a.png">', undefined],
    ["a base with a scheme and no slashes, which a browser reads beside the page", '<base href="https:docs/"><img src="/a.png">', "/a.png"],
    ["a base with a scheme and no host, which a browser sets aside", '<base href="data:text/html,x"><img src="/a.png">', "/a.png"],
    ["a no-break space before the slash, which is part of a relative address", '<a href="\u00a0/a.html">a</a>', undefined],
    ["a base on the install's own host for shared sites, which takes a file beside the page to the host's root", '<base href="https://sites.example.net/"><img src="logo.png">', "https://sites.example.net/"],
    ["a base on the install's own host, named before the root link after it", '<base href="https://sites.example.net/"><img src="/logo.png">', "https://sites.example.net/"],
    ["a base on the install's own host for private sites, with the page's scheme", '<base href="//private.example.net/notes/"><img src="logo.png">', "//private.example.net/notes/"],
    ["a base on the install's own host in capitals and with the scheme's own port", '<base href="HTTPS://SITES.EXAMPLE.NET:443/"><img src="logo.png">', "HTTPS://SITES.EXAMPLE.NET:443/"],
    ["a base that is the root alone, with no link after it", '<base href="/">', "/"],
    ["a base on another port of the install's hostname, which is another host", '<base href="https://sites.example.net:8443/"><img src="/logo.png">', undefined],
    ["a base on another host that signs in under the install's hostname", '<base href="https://sites.example.net@cdn.example.com/"><img src="/logo.png">', undefined],
    ["a second base on another host, which a browser sets aside", '<base href="./"><base href="https://cdn.example.com/"><img src="/logo.png">', "/logo.png"],
    ["a second base beside the page, after one on another host", '<base href="https://cdn.example.com/"><base href="./"><img src="/logo.png">', undefined],
    ["a second base from the root, which is no link of the page", '<base href="docs/"><base href="/x/"><a href="a.html">a</a>', undefined],
    ["a base on another host after one inside a template, which is no part of the page", '<template><base href="./"></template><base href="https://cdn.example.com/"><img src="/logo.png">', undefined],
    ["a base from the root after one inside a drawing, which is no base of the page", '<svg><base href="./"></svg><base href="/docs/"><a href="a.html">a</a>', "/docs/"],
    ["a base on another host after one with no href, which is not the page's base", '<base target="_blank"><base href="https://cdn.example.com/"><img src="/logo.png">', undefined],
  ])("a page with %s names its first root link, or none: %s -> %j", async (_name, page, link) => {
    const found = await firstRootLink([file("index.html", page)], HOSTS);

    expect(found).toEqual(link === undefined ? undefined : { file: "index.html", link });
  });

  test("a tag cut across three reads is read whole: without this a link past a file's first piece is missed, or read as two", async () => {
    const page = file("index.html", "<p>menu</p><a hr", 'ef="/me', 'nu.html">menu</a>');

    expect(await firstRootLink([page], HOSTS)).toEqual({ file: "index.html", link: "/menu.html" });
  });

  test("only .html and .htm files are read, in the listing's own order: without this a script's string refuses a publish, or the file named is not the first a person meets", async () => {
    using folder = mkdtempDisposableSync(join(tmpdir(), "poplin-root-links-"));
    const pages = {
      "app.js": 'document.body.innerHTML = \'<a href="/x">x</a>\';',
      "notes.txt": '<a href="/x">x</a>',
      "index.html": '<a href="docs/a.htm">a</a>',
      "z.html": '<a href="/z">z</a>',
      "docs/a.HTM": '<img src="/first.png"><img src="/second.png">',
    };
    for (const [path, text] of Object.entries(pages)) {
      mkdirSync(dirname(join(folder.path, path)), { recursive: true });
      writeFileSync(join(folder.path, path), text);
    }

    const listing = await readFiles(folder.path);
    if (!listing.ok) throw new Error(listing.reason);

    expect(listing.files.map((one) => one.path)).toEqual(["app.js", "docs/a.HTM", "index.html", "notes.txt", "z.html"]);
    expect(await firstRootLink(listing.files, HOSTS)).toEqual({ file: "docs/a.HTM", link: "/first.png" });
    expect(await firstRootLink(listing.files.filter((one) => !/\.html?$/i.test(one.path)), HOSTS)).toBeUndefined();
  });
});
