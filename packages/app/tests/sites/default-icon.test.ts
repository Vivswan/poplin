import { expect, test } from "bun:test";
import { join } from "node:path";
import { DEFAULT_ICON, DEFAULT_ICON_TYPE } from "../../src/sites/default-icon";

/** The drawing the website's own icon is made from. */
const BRAND_DRAWING = Bun.file(join(import.meta.dir, "..", "..", "..", "..", "brand", "favicon.svg"));

// Drift: the brand's icon would be redrawn and every site without an icon of its own would keep showing the old one, or the text would go out under a type that is not the drawing's.
test("the icon a site without one shows is the brand's favicon drawing, character for character, under the type of that file", async () => {
  expect([DEFAULT_ICON_TYPE, DEFAULT_ICON]).toEqual([BRAND_DRAWING.type, await BRAND_DRAWING.text()]);
});
