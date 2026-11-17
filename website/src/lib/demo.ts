/** One way into the running demo: what the top bar calls it, and its https address. */
interface DemoLink {
  readonly label: string;
  readonly href: string;
}

/** The two values a build may be given: the demo's address on each kind of install. */
interface DemoValues {
  /** The build's `DEMO_URL`: the demo of the install under a domain. */
  readonly domain: string | undefined;

  /** The build's `DEMO_URL_NO_DOMAIN`: the demo of the install without a domain. */
  readonly noDomain: string | undefined;
}

/** What the top bar holds for the demo: no entry, one plain link, or a menu of both kinds of install. */
type DemoEntry = { readonly kind: "none" } | { readonly kind: "one"; readonly link: DemoLink } | { readonly kind: "two"; readonly links: readonly [DemoLink, DemoLink] };

/** A value as an address, written as a browser writes it; nothing unless it is an https address. */
function httpsAddress(value: string | undefined): string | undefined {
  const given = URL.parse(value ?? "");

  return given?.protocol === "https:" ? given.href : undefined;
}

/** The running demo's address, from the build's `DEMO_URL`; nothing unless that is an https address. */
export function demoAddress(): string | undefined {
  return httpsAddress(process.env.DEMO_URL);
}

/** The top bar's demo entry from the build's two values: a value that is no https address counts as not given. */
export function demoEntry(values: DemoValues): DemoEntry {
  const domain = httpsAddress(values.domain);
  const noDomain = httpsAddress(values.noDomain);
  const links: DemoLink[] = [];
  if (domain !== undefined) links.push({ label: "With a domain", href: domain });
  if (noDomain !== undefined) links.push({ label: "Without a domain", href: noDomain });

  const [first, second] = links;
  if (first === undefined) return { kind: "none" };
  if (second === undefined) return { kind: "one", link: first };

  return { kind: "two", links: [first, second] };
}
