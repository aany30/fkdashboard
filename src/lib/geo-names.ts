/**
 * Resolves Google/DV360 geo **criteria IDs** → human names.
 *
 * DV360 Bid Manager geo dimensions (FILTER_REGION, FILTER_CITY) return only the
 * numeric geo criteria ID — there is NO name column in the report. This maps
 * those IDs to their canonical names using Google's public geo-targets table
 * (real, authoritative data — not estimated). Postal codes are excluded from the
 * bundle because Bid Manager already returns the actual code.
 *
 * Source: https://developers.google.com/google-ads/api/data/geotargets
 */

import geoData from "./data/geo-targets.json";

const MAP = geoData as Record<string, string>;

/** Name for a geo criteria ID, or null if the ID isn't in the table. */
export function geoName(id: string | number | null | undefined): string | null {
  if (id === null || id === undefined) return null;
  const key = String(id).trim();
  if (!key) return null;
  return MAP[key] ?? null;
}
