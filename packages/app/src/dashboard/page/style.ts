// The dashboard's one stylesheet, sent inline with every page: a quiet side with the sections, and a working area of tables with hairlines.

/** The brand's colours, for a light and a dark screen. Text is read on `ground` (the side), `lift` (the working area), and `tone` (a selected row or a quiet button); each state's ink on its own tint. */
export const PALETTE = {
  light: {
    ground: "#f5f7fa",
    lift: "#ffffff",
    tone: "#eef2f8",
    chosen: "#e2e8f2",
    line: "#e3e8f0",
    control: "#8a94a8",
    ink: "#141a2b",
    soft: "#4a5268",
    faint: "#5f6981",
    link: "#2c4fb3",
    danger: "#b9283f",
    dangerTint: "#fdecef",
    good: "#1b6e41",
    warn: "#8a5300",
    button: "#3b66d6",
    onButton: "#ffffff",
    privateTint: "#e6ebf3",
    privateInk: "#141a2b",
    unlistedTint: "#e6eeff",
    unlistedInk: "#2647a8",
    publicTint: "#dff2e5",
    publicInk: "#17643a",
    askTint: "#eef3ff",
    shade: "rgb(10 14 26 / 0.1)",
  },
  dark: {
    ground: "#0d111f",
    lift: "#141a2e",
    tone: "#212b4a",
    chosen: "#2a3559",
    line: "#252e4b",
    control: "#6a78a8",
    ink: "#eef1f8",
    soft: "#a7b1c9",
    faint: "#909bb6",
    link: "#9db6f8",
    danger: "#f58a9c",
    dangerTint: "#33202a",
    good: "#7fd09b",
    warn: "#f0c36d",
    button: "#5c82ea",
    onButton: "#0b0f1c",
    privateTint: "#2c3142",
    privateInk: "#eef1f8",
    unlistedTint: "#1c2a52",
    unlistedInk: "#9db6f8",
    publicTint: "#153224",
    publicInk: "#7fd09b",
    askTint: "#1a2444",
    shade: "rgb(0 0 0 / 0.4)",
  },
} as const;

/** The stylesheet. Rows are 44px on a wide screen and controls 28px in a row, 32px in a form; under 760px the side folds to a bar at the bottom and every control is 44px tall. */
export const STYLE = `
:root { color-scheme: light dark; ${variables(PALETTE.light)} --nav: 232px; --pad: 24px; --row: 44px; --h: 28px; --hf: 32px; --panel: 440px; --rc: 6px; --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; ${variables(PALETTE.dark)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${variables(PALETTE.dark)} } }
*, *::before, *::after { box-sizing: border-box; }
html { background: var(--lift); color: var(--ink); font: 400 14px/20px "Helvetica Neue", Arial, sans-serif; -webkit-text-size-adjust: 100%; }
body { margin: 0; font-variant-numeric: tabular-nums; }
h1, h2, p, ul, ol, dl, dd, form, fieldset { margin: 0; padding: 0; }
ul, ol { list-style: none; }
fieldset { border: 0; }
a { color: inherit; text-decoration: none; }
button, input, select { font: inherit; color: inherit; }
button { cursor: pointer; }
code { font: 12px/20px var(--mono); }
:focus-visible { outline: 2px solid var(--button); outline-offset: 1px; border-radius: var(--rc); }
svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
[hidden] { display: none !important; }
.skip { position: absolute; left: -999rem; }
.skip:focus { left: 12px; top: 8px; z-index: 9; padding: 8px 12px; background: var(--lift); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.soft { color: var(--soft); }
.faint { color: var(--faint); }
.num { text-align: right; }

.app { display: grid; grid-template-columns: var(--nav) minmax(0, 1fr); min-height: 100vh; }
.app.bare { grid-template-columns: minmax(0, 1fr); }
.side { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 2px; padding: 12px; background: var(--ground); border-right: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 8px; min-height: 32px; margin: 0 0 8px; padding: 0 8px; font-weight: 700; font-size: 14px; overflow-wrap: anywhere; }
.brand svg { width: 18px; height: 18px; stroke: none; }
.side nav a { display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 8px; border-radius: var(--rc); color: var(--soft); }
.side nav a:hover { color: var(--ink); }
.side nav a[aria-current] { background: var(--tone); color: var(--ink); font-weight: 700; }
.side .about { margin-top: auto; padding: 0 8px 4px; color: var(--faint); font-size: 12px; line-height: 16px; }
.side .about p { margin: 0; }
.side .about .news { margin: 0 -8px 8px; padding: 8px; border: 1px solid var(--line); border-radius: var(--rc); background: var(--lift); color: var(--soft); }
.side .about .news b { display: block; color: var(--ink); }
.side .about .news a { color: var(--link); font-weight: 700; }
.side .about .seg { display: grid; margin: 0 -8px 8px; font-size: 12px; }
.demo { display: flex; align-items: center; gap: 8px; margin: -8px 0 4px; color: var(--faint); font-size: 12px; }
.demo b { padding: 0 6px; border: 1px solid var(--line); border-radius: var(--rc); color: var(--soft); line-height: 18px; }
.demo .txt { font-size: 12px; }
main { position: relative; min-width: 0; padding: 20px var(--pad) 64px; }
.title { display: flex; align-items: center; gap: 8px; min-height: 32px; }
.title .end, .end { margin-left: auto; }
h1 { font-size: 16px; line-height: 24px; font-weight: 700; overflow-wrap: anywhere; }
h2 { font-size: 14px; line-height: 20px; font-weight: 700; margin: 28px 0 8px; }
main > p, main > dl, main > form, main > .scroll { margin: 12px 0 0; }
.tools { display: flex; align-items: flex-end; gap: 16px; min-height: 44px; border-bottom: 1px solid var(--line); }
.tabs { display: flex; gap: 20px; align-self: stretch; }
.tabs a { display: flex; align-items: center; color: var(--soft); box-shadow: inset 0 -2px 0 transparent; }
.tabs a[aria-current] { color: var(--ink); font-weight: 700; box-shadow: inset 0 -2px 0 var(--ink); }
.find { order: 2; display: flex; align-items: center; gap: 8px; margin-left: auto; padding-bottom: 6px; }
details.filter { align-self: center; }
details.menu.filter > summary { width: auto; gap: 6px; padding: 0 6px 0 0; color: var(--ink); font-weight: 700; white-space: nowrap; }
details.menu.filter > summary:hover, details.menu.filter[open] > summary { background: none; }
details.filter .pop { right: auto; left: 0; }
.pop [aria-current] { font-weight: 700; }
.find input { width: 260px; }

button, .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: var(--h); padding: 0 10px; }
button, .btn { border: 1px solid transparent; border-radius: var(--rc); background: var(--tone); color: var(--ink); font-weight: 700; font-size: 13px; white-space: nowrap; }
button:hover, .btn:hover { filter: brightness(0.96); }
button.pri, .btn.pri { background: var(--button); color: var(--onButton); }
button.f, .btn.f, main > form > button, .field ~ button, .setting ~ button { height: var(--hf); padding: 0 14px; }
button.danger { color: var(--danger); }
button.ic, .ic { display: inline-flex; align-items: center; justify-content: center; width: var(--h); height: var(--h); padding: 0; border-radius: var(--rc); background: none; color: var(--soft); }
button.ic:hover, .ic:hover { background: var(--tone); color: var(--ink); filter: none; }
button.ic.done { color: var(--good); }
button.failed { color: var(--danger); }
button.txt, .txt { display: inline-flex; align-items: center; height: var(--h); padding: 0; border: 0; background: none; color: var(--soft); font-weight: 700; font-size: 13px; }
button.txt:hover, .txt:hover { color: var(--ink); filter: none; }
button.txt.danger, .txt.danger { color: var(--danger); }
button + button { margin-left: 8px; }
input[type="text"], input[type="search"], input[type="email"], input[type="password"], select { height: var(--hf); padding: 0 10px; border: 1px solid var(--control); border-radius: var(--rc); background: var(--lift); min-width: 0; }
.field input:not([type="checkbox"]), .field select { display: block; width: 100%; max-width: 28rem; }
input[type="checkbox"] { width: 16px; height: 16px; margin: 0; flex: none; accent-color: var(--button); }
input::placeholder { color: var(--faint); }
label, legend { display: block; font-weight: 700; }
label.choice { display: flex; align-items: center; gap: 8px; min-height: var(--hf); font-weight: 400; }
.field { margin: 0 0 12px; }
.hint, .warning, small { color: var(--soft); font-size: 13px; }
.warning { padding-left: 10px; border-left: 2px solid var(--danger); }
.notice { padding: 10px 12px; border-radius: var(--rc); background: var(--askTint); }
.notice.refused { background: var(--dangerTint); }

.st { display: inline-flex; flex: none; align-items: center; gap: 6px; color: var(--soft); font-weight: 400; font-size: 13px; white-space: nowrap; }
.st svg { width: 13px; height: 13px; }
.st.unlisted svg { color: var(--unlistedInk); }
.st.public svg { color: var(--publicInk); }
.lk { display: block; color: var(--soft); font: 12px/20px var(--mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mask { letter-spacing: 1px; color: var(--faint); }

.rows > li { position: relative; display: grid; grid-template-columns: var(--cols); column-gap: 16px; align-items: center; min-height: var(--row); border-bottom: 1px solid var(--line); }
.rows > li > * { min-width: 0; }
.rows > .th { min-height: 36px; color: var(--faint); font-size: 12px; }
.rows > li:not(.th):hover { background: var(--tone); box-shadow: -24px 0 0 var(--tone), 24px 0 0 var(--tone); }
.rows > .sel, .rows > .sel:not(.th):hover { background: var(--chosen); box-shadow: -24px 0 0 var(--chosen), 24px 0 0 var(--chosen); }
.rows > li:has(details[open]) .on { z-index: 6; }
.rows > li:has(.name a:focus-visible) { outline: 2px solid var(--button); outline-offset: -2px; }
.name a:focus-visible { outline: none; }
.rows > .tr .acts > * { opacity: 1; }
.name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name a::after { content: ""; position: absolute; inset: 0; }
.on { position: relative; z-index: 1; }
.acts { display: flex; justify-content: flex-end; gap: 4px; }
.sites { --cols: 232px 124px minmax(0, 1fr) 168px 64px; }
.rows .acts > * { opacity: 0; }
.rows > li:hover .acts > *, .rows > li:focus-within .acts > *, .rows .acts > details[open] { opacity: 1; }
@media (hover: none) { .rows .acts > * { opacity: 1; } }
.sites > .tr { --cols: 232px minmax(0, 1fr) auto; }
.blk .hint { margin-top: 6px; }
.empty { padding: 12px 0; color: var(--soft); border-bottom: 1px solid var(--line); }
.foot { display: flex; align-items: center; gap: 16px; min-height: var(--row); color: var(--soft); }
.foot a { color: var(--link); font-weight: 700; }

details.menu { position: relative; }
details.menu > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; width: var(--h); height: var(--h); border-radius: var(--rc); color: var(--soft); }
details.menu > summary::-webkit-details-marker { display: none; }
details.menu > summary:hover, details.menu[open] > summary { background: var(--tone); color: var(--ink); }
.pop { position: absolute; z-index: 5; right: 0; top: calc(100% + 4px); min-width: 176px; padding: 4px; border: 1px solid var(--line); border-radius: 8px; background: var(--lift); box-shadow: 0 8px 24px var(--shade); }
.pop a, .pop button { display: flex; justify-content: flex-start; align-items: center; width: 100%; height: var(--hf); margin: 0; padding: 0 8px; border-radius: 4px; background: none; font-weight: 400; font-size: 13px; }
.pop form { display: contents; }
.pop a:hover, .pop button:hover { background: var(--tone); filter: none; }

.panel { position: fixed; z-index: 3; top: 0; bottom: 0; right: 0; width: var(--panel); overflow: auto; padding: 20px var(--pad) 32px; background: var(--lift); border-left: 1px solid var(--line); box-shadow: -12px 0 32px var(--shade); }
.panel h2 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
.panel h2:focus { outline: none; }
.panel .lk { white-space: normal; overflow-wrap: anywhere; }
.panel form.title { flex-wrap: wrap; }
.panel form.title input { flex: 1; }
.hint.bad { color: var(--danger); }
.blk { padding: 14px 0; border-bottom: 1px solid var(--line); }
.blk:last-child { border-bottom: 0; }
.lab { margin-bottom: 6px; color: var(--faint); font-size: 12px; line-height: 16px; }
.line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.line > a.txt + a.txt { margin-left: 8px; }
.line .lk { flex: 1 1 100%; color: var(--ink); font-size: 13px; white-space: normal; overflow-wrap: anywhere; }
.seg { display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; height: var(--hf); padding: 2px; border-radius: 8px; background: var(--tone); font-weight: 700; font-size: 13px; }
.seg > form { display: grid; }
.seg a, .seg button, .seg span { display: flex; align-items: center; justify-content: center; gap: 6px; height: auto; margin: 0; padding: 0 12px; border: 0; border-radius: var(--rc); background: none; color: var(--soft); white-space: nowrap; }
.seg [aria-current], .seg [aria-pressed="true"] { background: var(--lift); color: var(--ink); }
.ask { display: grid; gap: 8px; margin-top: 10px; padding: 10px; border-radius: var(--rc); background: var(--askTint); font-size: 13px; }
.facts { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 0 12px; }
.facts dt { color: var(--faint); font-size: 13px; }
.facts dt, .facts dd { min-height: 28px; padding: 4px 0; overflow-wrap: anywhere; }
.ver { display: grid; grid-template-columns: 32px 36px minmax(0, 1fr) auto; column-gap: 12px; align-items: center; min-height: 36px; font-size: 13px; }
.ver + .ver { border-top: 1px solid var(--line); }
.ver > :nth-child(3) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.live { color: var(--good); font-weight: 700; font-size: 12px; }
.panel details > summary { cursor: pointer; font-weight: 700; font-size: 13px; color: var(--soft); min-height: var(--h); display: flex; align-items: center; }
.panel details > summary::after { content: ""; width: 6px; height: 6px; margin: 0 0 3px 8px; border: solid currentColor; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); }
.panel details[open] > summary::after { margin-bottom: -3px; transform: rotate(-135deg); }
.panel details[open] > summary { margin-bottom: 8px; color: var(--ink); }
.blk p + button { margin-top: 8px; }

.result { display: flex; align-items: center; gap: 12px; }
.result .notice { padding: 0; background: none; }
.result button { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
.result button:hover { color: inherit; }
body > .notice, body > .result { position: fixed; z-index: 6; left: calc(var(--nav) + var(--pad)); bottom: 20px; max-width: min(640px, calc(100vw - var(--nav) - 2 * var(--pad))); margin: 0; }
body > .notice, body > .result { padding: 10px 14px; border-radius: 8px; background: var(--ink); color: var(--lift); font-size: 13px; box-shadow: 0 8px 24px var(--shade); }
body > .notice.refused { background: var(--danger); color: var(--lift); }
.bare ~ .notice { left: var(--pad); }

.scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { height: var(--row); padding: 0 16px 0 0; text-align: left; vertical-align: middle; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { height: 36px; color: var(--faint); font-size: 12px; font-weight: 400; }
td.wrap { white-space: normal; min-width: 10rem; overflow-wrap: anywhere; }
td form { margin: 0; }
main > dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 24px; }
main > dl dt { color: var(--soft); }
dd { overflow-wrap: anywhere; }
.state { font-weight: 700; font-size: 13px; color: var(--soft); }
.state.good { color: var(--good); }
.state.bad { color: var(--danger); }
.setting { display: grid; grid-template-columns: 320px minmax(0, 420px); gap: 4px 32px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.when-public { display: none; }
fieldset:has(input[value="public"]:checked) .when-public { display: block; }
.code { font: 700 14px/20px var(--mono); letter-spacing: 0.06em; overflow-wrap: anywhere; }
meter { display: block; width: 100%; max-width: 20rem; height: 12px; }

@media (max-width: 760px) {
  :root { --pad: 16px; --h: 44px; --hf: 44px; --row: 64px; }
  .app { display: block; padding-bottom: 57px; }
  .app.bare { padding-bottom: 0; }
  .side { position: fixed; z-index: 4; top: auto; bottom: 0; left: 0; right: 0; height: 57px; flex-direction: row; padding: 0; gap: 0; border: 0; border-top: 1px solid var(--line); }
  .side .brand, .side .about { display: none; }
  .side nav { width: 100%; }
  .side nav ul { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; }
  .side nav a { flex-direction: column; justify-content: center; gap: 2px; height: 56px; padding: 0; border-radius: 0; font-size: 12px; line-height: 16px; }
  .side nav a[aria-current] { background: none; color: var(--link); }
  main { padding: 12px var(--pad) 32px; }
  .title { min-height: 44px; }
  .tools { flex-direction: column; align-items: stretch; gap: 0; }
  .find { order: 0; }
  details.filter { align-self: flex-start; }
  .rows .acts > * { opacity: 1; }
  .name a { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .tabs { min-height: 44px; overflow-x: auto; }
  .tabs a { flex: none; }
  .find { margin: 0; padding: 4px 0; }
  .find input { flex: 1; width: auto; }
  .rows > .th { display: none; }
  .sites { --cols: minmax(0, 1fr) 88px; }
  .sites > li { grid-template-areas: "n a" "l a"; align-content: center; column-gap: 8px; }
  .sites > li > * { display: none; }
  .sites > li > .name { display: flex; align-items: center; gap: 8px; grid-area: n; }
  .sites > li > .lkc { display: block; grid-area: l; }
  .sites > li > .acts { display: flex; grid-area: a; }
  .has-panel main > :not(.panel):not(.title):not(.demo) { display: none; }
  .panel { position: static; width: auto; padding: 0; border: 0; box-shadow: none; }
  .panel .close { display: none; }
  .has-panel h1 a::before { content: "\\2039\\00a0"; color: var(--faint); }
  .sites > .tr { --cols: minmax(0, 1fr) auto; grid-template-areas: "n a" "l a"; }
  body > .notice, body > .result { left: var(--pad); right: var(--pad); bottom: 69px; max-width: none; }
  .bare ~ .notice { bottom: 16px; }
  main > dl, .setting { grid-template-columns: minmax(0, 1fr); }
  .foot { flex-wrap: wrap; padding: 8px 0; }
}
@media (min-width: 761px) { .name .st { display: none; } .has-panel .rows .acts, .has-panel .rows .lkc, .has-panel .rows > li > .soft, .has-panel .find, .has-panel .th > :nth-child(n + 3) { visibility: hidden; } }
`;

function variables(colours: (typeof PALETTE)["light" | "dark"]): string {
  return Object.entries(colours)
    .map(([name, value]) => `--${name}: ${value};`)
    .join(" ");
}
