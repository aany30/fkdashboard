/**
 * Account-currency-aware formatters.
 *
 * The account currency is pulled from the first campaign that has a `currency`
 * field (Meta's `account_currency`). This is used everywhere money is displayed
 * so ₹ / € / £ accounts are shown correctly instead of always using $.
 *
 * AI Credits remain in USD (Anthropic bills in USD) — use `formatUsd` there.
 */

import type { CampaignData } from "@/types";

/** Detect the account currency from a campaign list. Defaults to "USD". */
export function detectCurrency(campaigns: CampaignData[]): string {
  return campaigns.find((c) => c.currency)?.currency ?? "USD";
}

/**
 * Per-platform currency. In "both" mode the campaign list mixes Meta (e.g. INR)
 * and DV360 (e.g. USD) rows, so a single detectCurrency() would pick whichever
 * happens to be first. Always resolve the currency for the platform whose money
 * you're about to format. Falls back to the account-wide currency when that
 * platform has no campaigns loaded yet (keeps a sensible symbol during load).
 */
export function currencyFor(campaigns: CampaignData[], platform: "meta" | "dv360"): string {
  const scoped = campaigns.filter((c) => c.platform === platform);
  return scoped.find((c) => c.currency)?.currency ?? detectCurrency(campaigns);
}

/** Format a monetary value using the account currency (e.g. ₹45,108 or $264). */
export function formatMoney(
  value: number | undefined | null,
  currency: string,
  maximumFractionDigits = 2
): string {
  if (value === undefined || value === null || isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits,
    }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString()}`;
  }
}

/** Always format in USD — for AI credit costs only. */
export function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}
