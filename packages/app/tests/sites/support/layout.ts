// The address layout the app's tests run under, built from plain values with core's own parsers: sites are `<label>-page.example.com`.

import { type Hostname, parseHostname } from "@poplin/core/src/names/hostname";
import { parseSuffix } from "@poplin/core/src/names/suffix";
import { hostnameAddresses } from "../../../src/sites/hostname-addresses";

/** Check a hostname that a test wrote by hand; a refusal is a mistake in the test. */
function hostOf(raw: string): Hostname {
  const hostname = parseHostname(raw);
  if (!hostname.ok) throw new Error(`the test's hostname was refused: ${hostname.refusal}`);

  return hostname.value;
}

function layout(): Parameters<typeof hostnameAddresses>[0] {
  const suffix = parseSuffix("-page");
  if (!suffix.ok) throw new Error(`the test's suffix was refused: ${suffix.refusal}`);

  return { domain: hostOf("example.com"), adminHostname: hostOf("admin.example.com"), suffix: suffix.value };
}

/** The checked values of the layout: the domain, the admin hostname under it, and the suffix. */
export const LAYOUT = layout();

/** The layout's answers, as serving, the login, and the site actions ask them. */
export const ADDRESSES = hostnameAddresses(LAYOUT);
