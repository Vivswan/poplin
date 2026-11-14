import { expect, test } from "bun:test";

import { PALETTE } from "../../../src/dashboard/page/style";

/** The least contrast WCAG 2 asks between text and its ground. */
const AA = 4.5;

/** The least contrast WCAG 2 asks between an input's border and its ground. */
const AA_EDGE = 3;

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => (channel <= 0.039_28 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(text: string, ground: string): number {
  const [dark, light] = [luminance(text), luminance(ground)].sort((left, right) => left - right) as [number, number];

  return (light + 0.05) / (dark + 0.05);
}

test("every pair of a text colour and the ground it is read on meets WCAG AA, on a light and on a dark screen", () => {
  const failing: string[] = [];

  for (const [screen, colours] of Object.entries(PALETTE)) {
    const pairs = [
      ["ink", "ground"],
      ["ink", "lift"],
      ["ink", "tone"],
      ["soft", "ground"],
      ["link", "ground"],
      ["link", "lift"],
      ["danger", "ground"],
      ["onButton", "button"],
    ] as const;

    for (const [text, ground] of pairs) {
      const ratio = contrast(colours[text], colours[ground]);
      if (ratio < AA) failing.push(`${screen} ${text} on ${ground}: ${ratio.toFixed(2)}`);
    }

    const edge = contrast(colours.soft, colours.ground);
    if (edge < AA_EDGE) failing.push(`${screen} input border: ${edge.toFixed(2)}`);
  }

  expect(failing).toEqual([]);
});
