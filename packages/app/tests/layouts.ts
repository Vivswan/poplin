// The layouts and hostnames the planner tests share, each checked the way setup checks one.

import { type Hostname, parseHostname } from "../src/cloudflare/hostname";
import { type DomainLayout, parseDomainLayout, type RawLayout } from "../src/cloudflare/layout";

const BASE: RawLayout = { domain: "example.com", admin_hostname: "admin.example.com", suffix: "-page" };

/** Check a layout that a test wrote by hand; a refusal is a mistake in the test. */
function layoutOf(changes: Partial<RawLayout>): DomainLayout {
  const layout = parseDomainLayout({ ...BASE, ...changes });
  if (!layout.ok) throw new Error(`the test's layout was refused: ${layout.refusal}`);

  return layout.value;
}

/** Check a hostname that a test wrote by hand; a refusal is a mistake in the test. */
export function hostOf(raw: string): Hostname {
  const hostname = parseHostname(raw);
  if (!hostname.ok) throw new Error(`the test's hostname was refused: ${hostname.refusal}`);

  return hostname.value;
}

/** The default layout: sites are `<name>-page.example.com`. */
export const SUFFIXED = layoutOf({});

/** Another suffix and a deeper admin hostname. */
export const OTHER_SUFFIX = layoutOf({ suffix: "-s1-x", admin_hostname: "admin.tools.example.com" });
