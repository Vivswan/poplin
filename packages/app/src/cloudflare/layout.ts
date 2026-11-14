// The zone values of an install with a domain, after their checks: each is already safe to write into a record, a route, or a rule.

import { parseSuffix, type Suffix } from "@poplin/core/src/names/suffix";
import { type Hostname, isUnder, parseHostname } from "./hostname";

declare const layoutBrand: unique symbol;

/** The layout as the Worker's `ZONE` binding, the settings, or a form hold it, unchecked. `admin_hostname` is the whole hostname, domain included. */
export interface RawLayout {
  readonly domain: string;
  readonly admin_hostname: string;
  readonly suffix: string;
}

/** A layout made by `parseDomainLayout` alone: the admin hostname is under the domain and is no site address. */
export interface DomainLayout {
  readonly domain: Hostname;
  readonly adminHostname: Hostname;
  readonly suffix: Suffix;
  readonly [layoutBrand]: true;
}

/** Why a layout was refused. */
type LayoutRefusal = "bad-domain" | "bad-admin-hostname" | "bad-suffix" | "admin-outside-domain" | "admin-is-site-address";

/** A layout, or the first rule it breaks. */
export type CheckedLayout = { readonly ok: true; readonly value: DomainLayout } | { readonly ok: false; readonly refusal: LayoutRefusal };

/**
 * Check a layout before any of it reaches Cloudflare.
 *
 * @returns the layout, or the first rule it breaks
 */
export function parseDomainLayout(raw: RawLayout): CheckedLayout {
  const domain = parseHostname(raw.domain);
  if (!domain.ok) return { ok: false, refusal: "bad-domain" };

  const admin = parseHostname(raw.admin_hostname);
  if (!admin.ok) return { ok: false, refusal: "bad-admin-hostname" };

  if (!isUnder(admin.value, domain.value)) return { ok: false, refusal: "admin-outside-domain" };

  const suffix = parseSuffix(raw.suffix);
  if (!suffix.ok) return { ok: false, refusal: "bad-suffix" };

  // The site route would take it, and the Worker would read it as a site.
  if (admin.value.endsWith(`${suffix.value}.${domain.value}`)) return { ok: false, refusal: "admin-is-site-address" };

  return { ok: true, value: { domain: domain.value, adminHostname: admin.value, suffix: suffix.value } as DomainLayout };
}

/**
 * Write what every site hostname ends with: the suffix, a dot, and the domain.
 *
 * @returns the ending a Worker route takes after its leading wildcard; the gallery's hostname ends with it too
 */
export function siteEnding(layout: DomainLayout): string {
  return `${layout.suffix}.${layout.domain}`;
}
