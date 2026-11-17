import { expect, test } from "bun:test";

import { rebased } from "../../../src/preview/addresses/base";

/** The path the demo under test sits under. */
const BASE = "/poplin/demo";

/** Markup as a page may write it, and the same markup under the base: each row names what a browser reads there. */
const PAGES: readonly (readonly [reads: string, page: string, based: string])[] = [
  ["double quotes", '<a href="/a">go</a>', '<a href="/poplin/demo/a">go</a>'],
  ["single quotes", "<a href='/a'>go</a>", "<a href='/poplin/demo/a'>go</a>"],
  ["no quotes", "<a href=/a>go</a>", '<a href="/poplin/demo/a">go</a>'],
  ["no quotes, and a slash that belongs to the address", "<a href=/a/>go</a>", '<a href="/poplin/demo/a/">go</a>'],
  ["an attribute's name in capitals", '<A HREF="/a">go</A>', '<A HREF="/poplin/demo/a">go</A>'],
  ["an address with an entity, kept as written", '<a href="/a?b=1&amp;c=2">go</a>', '<a href="/poplin/demo/a?b=1&amp;c=2">go</a>'],
  ["a form and its button", '<form action="/a"><button formaction="/b">go</button></form>', '<form action="/poplin/demo/a"><button formaction="/poplin/demo/b">go</button></form>'],
  ["an image, a script, and a video's still", '<img src="/a.png"><script src="/b.js"></script><video poster="/c.png"></video>', '<img src="/poplin/demo/a.png"><script src="/poplin/demo/b.js"></script><video poster="/poplin/demo/c.png"></video>'],
  ["a link after a comment that ends at once", '<!--><a href="/a">go</a>', '<!--><a href="/poplin/demo/a">go</a>'],
  ["a link after a comment that ends with a bang", '<!-- x --!><a href="/a">go</a>', '<!-- x --!><a href="/poplin/demo/a">go</a>'],
  ["a script whose tag closes itself, which a browser ignores", "<script/>const link = '<a href=\"/a\">';</script>", "<script/>const link = '<a href=\"/a\">';</script>"],
  ["text in a script", "<script>const link = '<a href=\"/a\">';</script>", "<script>const link = '<a href=\"/a\">';</script>"],
  ["text in a style", '<style>a[href="/a"] { color: red }</style>', '<style>a[href="/a"] { color: red }</style>'],
  ["text in a pre", '<pre>href="/a" &lt;a href="/b"&gt;</pre>', '<pre>href="/a" &lt;a href="/b"&gt;</pre>'],
  ["text in a textarea", '<textarea><a href="/a">go</a></textarea>', '<textarea><a href="/a">go</a></textarea>'],
  ["text in a title", '<title><a href="/a">go</a></title>', '<title><a href="/a">go</a></title>'],
  ["text in a comment", '<!-- <a href="/a">go</a> -->', '<!-- <a href="/a">go</a> -->'],
  ["an attribute that only ends in an address's name", '<a data-href="/a">go</a>', '<a data-href="/a">go</a>'],
  ["an address of another host", '<a href="//elsewhere.example/a">go</a>', '<a href="//elsewhere.example/a">go</a>'],
  ["an address beside the page", '<a href="a.html">go</a>', '<a href="a.html">go</a>'],
  ["a page that ends inside a comment", '<a href="/a">go</a><!--', '<a href="/poplin/demo/a">go</a><!--'],
];

test("under a base, an address moves however the page writes it, and text that only looks like one stays: without this a link in single quotes or without quotes leads off the demo, and code a page shows or runs is rewritten", async () => {
  const based = PAGES.map(async ([reads, page]) => {
    const answer = await rebased(new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } }), BASE, "https://example.com");

    return [reads, page, await answer.text()];
  });

  // A base that holds the quote the page used: inside the address it is written as its entity.
  const apostrophe = await rebased(new Response("<a href='/a'>go</a>", { headers: { "Content-Type": "text/html" } }), "/it's", "https://example.com");

  expect(await Promise.all(based)).toEqual(PAGES.map((row) => [...row]));
  expect(await apostrophe.text()).toBe("<a href='/it&#39;s/a'>go</a>");
});
