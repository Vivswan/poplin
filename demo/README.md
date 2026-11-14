# Demo samples

The four static sites the public demo shows. Each is the kind of thing an agent builds and publishes in one call.

| Sample             | What it shows                                                       | Entry file                              |
| ------------------ | ------------------------------------------------------------------- | --------------------------------------- |
| Sales report       | A data report: four hand-drawn SVG charts, a summary table, notes   | `samples/sales-report/index.html`       |
| Launch deck        | A nine-slide deck: arrow keys, tap, swipe, a progress indicator     | `samples/launch-deck/index.html`        |
| Checkout prototype | A clickable three-step checkout with all state in memory            | `samples/checkout-prototype/index.html` |
| Trip summary       | A one-page itinerary: route, timeline, costs table, no script       | `samples/trip-summary/index.html`       |

```text
samples/<name>/
  index.html     the page, with a real <title>
  base.css       the shared look, byte-identical in every sample: copy it, never edit one copy
  site.css       the accent color and the layout of this sample
  *.js, assets/  classic scripts and small SVG files, only where the sample needs them
```

## Rules for a fifth sample

- Self-contained and relative: every file the page loads sits in its folder and is linked as `./file` or `assets/file`. No CDN, web font, external image, analytics, build step, framework, or `package.json`.
- Sandbox-safe: state lives in memory only. No `localStorage`, `sessionStorage`, cookies, IndexedDB, `window.open`, or form that submits; classic `<script defer>` rather than modules, so the page also opens straight from disk.
- Small, fictional, and accessible: under 200 KB, plain ASCII, invented names and data only; responsive to 360 px, light and dark, reduced motion, visible focus, labelled charts; the last line is "Published by an agent with poplin in one call."
