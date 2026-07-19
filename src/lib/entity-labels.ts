/**
 * Platform-aware labels for the campaign hierarchy levels.
 *
 * Meta:  Campaign → Ad Set → Ad
 * DV360: Campaign → Insertion Order → Line Item
 *
 * DV360 entities ride in the same CampaignData nesting slots (adSets / ads),
 * so tables use these labels instead of hardcoding "Ad Sets"/"Ads".
 */

export function entityLabels(platform: "meta" | "dv360" | "both"): {
  level2: string;
  level3: string;
  level2Short: string;
  level3Short: string;
} {
  if (platform === "dv360") {
    return { level2: "Insertion Orders", level3: "Line Items", level2Short: "IO", level3Short: "LI" };
  }
  if (platform === "meta") {
    return { level2: "Ad Sets", level3: "Ads", level2Short: "AS", level3Short: "AD" };
  }
  return { level2: "Ad Sets · IOs", level3: "Ads · LIs", level2Short: "AS", level3Short: "AD" };
}

/** Per-row chip label for the middle/leaf levels, based on the row's platform. */
export function levelChip(platform: "meta" | "dv360", level: 2 | 3): string {
  if (platform === "dv360") return level === 2 ? "IO" : "LI";
  return level === 2 ? "AS" : "AD";
}
