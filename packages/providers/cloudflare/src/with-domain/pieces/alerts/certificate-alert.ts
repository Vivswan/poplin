// The certificate alert of an install with a domain: Cloudflare emails the install's first user when a certificate it issues for a domain fails to validate, is issued, is renewed, or runs out.
// Cloudflare takes no filter for this type, so the alert is the account's: it covers every domain of the account, not the install's alone.
// An install without a domain has none: its address is Cloudflare's own, and so is that address's certificate.

import type { AccountAlert } from "../../../shared/install/pieces/alerts/account-alert";

/** poplin's certificate alert, of Cloudflare's type for the certificates it issues for a domain by itself. Its name says what it covers, since its row and Cloudflare's list show the name alone. */
export const CERTIFICATE_ALERT: AccountAlert = {
  name: "poplin: certificates of every domain of the account",
  type: "universal_ssl_event_type",
  description: "A certificate Cloudflare issues for a domain of the account failed to validate, was issued, was renewed, or ran out.",
};
