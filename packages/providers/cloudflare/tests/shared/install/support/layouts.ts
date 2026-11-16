// The layouts and hostnames the planner tests share, each checked the way setup checks one.

import { type Hostname, parseHostname } from "@poplin/core/src/names/hostname";
import { type AccountAddresses, parseAccountAddresses } from "../../../../src/without-domain/address-layout";
import { type DomainLayout, parseDomainLayout, type RawLayout } from "../../../../src/with-domain/layout";

const BASE: RawLayout = { domain: "example.com" };

/** Check a layout that a test wrote by hand; a refusal is a mistake in the test. */
export function layoutOf(changes: Partial<RawLayout>): DomainLayout {
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

/** The layout the tests run under: label addresses end in `-poplin.example.com`, public names in `-page.example.com`, and the dashboard is `poplin.example.com`. */
export const LAYOUT = layoutOf({});

/** A layout whose public word is `poplin`: every site hostname ends alike, in `-poplin.example.com`. */
export const ONE_WORD = layoutOf({ public_word: "poplin" });

/** Check the addresses of an install without a domain that a test wrote by hand; a refusal is a mistake in the test. */
function addressesOf(account: string, worker: string): AccountAddresses {
  const layout = parseAccountAddresses({ account_address: account }, worker);
  if (!layout.ok) throw new Error(`the test's addresses were refused: ${layout.refusal}`);

  return layout.value;
}

/** The addresses the tests of an install without a domain run under: the Worker `poplin` on the account `example`, so the dashboard is `poplin.example.workers.dev`. */
export const ADDRESSES = addressesOf("example", "poplin");
