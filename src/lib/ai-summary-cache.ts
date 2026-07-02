/**
 * Shared session cache for AI executive summaries.
 * Both AIExecutiveSummary and TabSummaryFooter import from here so that
 * the first component to fetch a given tab's summary caches it and the
 * second component reuses it — preventing duplicate API calls and ensuring
 * both components always show identical text.
 *
 * Cache key format: `${tabName}||${platform}||${dateRange}`
 * (double-pipe separator to avoid accidental collisions with names containing hyphens)
 */

export interface SummaryResponse {
  headline: string;
  overview: string;
  keyFindings: string[];
  recommendations: string[];
  source: "ai" | "fallback";
  creditsUsedUsd?: number;
}

export const AI_SUMMARY_CACHE = new Map<string, SummaryResponse>();

export function summaryKey(tabName: string, platform: string, dateRange?: string): string {
  return `${tabName}||${platform}||${dateRange ?? ""}`;
}
