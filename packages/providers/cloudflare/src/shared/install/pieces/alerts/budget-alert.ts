// The account's budget alert: Cloudflare emails the users the install's settings choose once the account's usage charges for the billing period reach one dollar.
// It is an alert of an install of either kind: the charges are the account's.

import type { AccountAlert } from "./account-alert";

/** poplin's budget alert. The filter takes exactly one value: the charges, in whole US dollars, at which the alert is sent. */
export const BUDGET_ALERT: AccountAlert = {
  name: "poplin: usage charges reached 1 dollar",
  type: "billing_budget_alert",
  description: "The account's usage charges for the billing period reached 1 US dollar.",
  filters: { total_spend_dollars: ["1"] },
};
