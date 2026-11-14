// The dashboard's one stylesheet, sent inline with every page: one left edge, one content width, two text sizes and one for headings.

/** The brand's colours, for a light and a dark screen. Each text colour is read against `ground`, `lift`, and `tone`. */
export const PALETTE = {
  light: { ground: "#f5f7fa", lift: "#ffffff", tone: "#e7ecf4", line: "#d6deeb", ink: "#141a2b", soft: "#4a5268", link: "#2f55b8", danger: "#c22f49", good: "#1b6e41", button: "#3b66d6", onButton: "#ffffff" },
  dark: { ground: "#141a2b", lift: "#1e2640", tone: "#1e2640", line: "#2a3454", ink: "#f5f7fa", soft: "#b9c2d6", link: "#9db6f5", danger: "#f58a9c", good: "#7fd6a2", button: "#3b66d6", onButton: "#ffffff" },
} as const;

/** The stylesheet. The brand's two typefaces are named by their system fallbacks alone: nothing is loaded. */
export const STYLE = `
:root { color-scheme: light dark; ${variables(PALETTE.light)} }
@media (prefers-color-scheme: dark) { :root { ${variables(PALETTE.dark)} } }
* { box-sizing: border-box; }
html { font: 1.0625rem/1.6 Georgia, "Times New Roman", serif; background: var(--ground); color: var(--ink); }
body { margin: 0 auto; max-width: 64rem; padding: 1.5rem 1.25rem 4rem; }
h1, h2, .brand, nav, th, dt, label, legend, button { font-family: "Helvetica Neue", Arial, sans-serif; }
h1 { font-size: 1.5rem; line-height: 1.25; margin: 2rem 0 1rem; }
h2 { font-size: 1rem; margin: 2.5rem 0 0.5rem; }
p, dl, ol, table, fieldset { margin: 0 0 1rem; }
a { color: var(--link); }
code { font: 0.875rem ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
.skip { position: absolute; left: -999rem; }
.skip:focus { left: 1.25rem; top: 0.5rem; padding: 0.5rem 1rem; background: var(--lift); }
.brand { margin: 0 0 0.5rem; font-weight: 700; overflow-wrap: anywhere; }
nav ul { display: flex; flex-wrap: wrap; gap: 0.25rem 1.5rem; margin: 0; padding: 0 0 0.5rem; list-style: none; border-bottom: 1px solid var(--line); }
nav a { color: var(--soft); text-decoration: none; }
nav a[aria-current] { color: var(--ink); font-weight: 700; text-decoration: underline; text-underline-offset: 0.4rem; text-decoration-thickness: 2px; }
.notice { padding: 0.75rem 1rem; border-left: 4px solid var(--link); background: var(--tone); }
.notice.refused, .warning { border-left: 4px solid var(--danger); }
.warning { padding-left: 0.75rem; }
.hint, .warning, th, dt, small { font-size: 0.875rem; }
.hint, dt { color: var(--soft); }
.scroll { overflow-x: auto; margin: 0 0 1rem; }
table { width: 100%; border-collapse: collapse; margin: 0; }
th, td { padding: 0.5rem 1.5rem 0.5rem 0; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); white-space: nowrap; }
td.wrap { white-space: normal; min-width: 10rem; overflow-wrap: anywhere; }
.state { font: 700 0.875rem "Helvetica Neue", Arial, sans-serif; color: var(--soft); }
.state.good { color: var(--good); }
.state.bad { color: var(--danger); }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.25rem 1.5rem; }
dd { margin: 0; overflow-wrap: anywhere; }
form { margin: 0 0 1rem; }
fieldset { border: 0; padding: 0; }
label, legend { display: block; padding: 0; font-weight: 700; }
label.choice { font-weight: 400; }
.field { margin: 0 0 1rem; }
.field p { margin: 0; }
input[type="text"], input[type="password"], select { display: block; width: 100%; max-width: 28rem; padding: 0.5rem; font: inherit; color: var(--ink); background: var(--lift); border: 1px solid var(--soft); border-radius: 4px; }
button { padding: 0.5rem 1rem; font-size: 1rem; font-weight: 700; color: var(--onButton); background: var(--button); border: 1px solid var(--button); border-radius: 4px; cursor: pointer; }
button + button { margin-left: 0.5rem; }
button.danger { color: var(--danger); background: transparent; border-color: var(--danger); }
.setting { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.25rem 2rem; padding: 1rem 0; border-bottom: 1px solid var(--line); }
.setting p { margin: 0; }
.setting ~ button { margin-top: 1rem; }
.when-public { display: none; }
fieldset:has(input[value="public"]:checked) .when-public { display: block; }
meter { display: block; width: 100%; max-width: 20rem; height: 1rem; }
@media (max-width: 40rem) {
  dl, .setting { grid-template-columns: minmax(0, 1fr); }
  dd { margin: 0 0 0.5rem; }
}
`;

function variables(colours: (typeof PALETTE)["light" | "dark"]): string {
  return Object.entries(colours)
    .map(([name, value]) => `--${name}: ${value};`)
    .join(" ");
}
