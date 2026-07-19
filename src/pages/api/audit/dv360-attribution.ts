/**
 * POST /api/audit/dv360-attribution
 *
 * Returns DV360/CM360 attribution health:
 * - CM360 hybrid link status OR third-party line-item-based Floodlight detection
 * - Floodlight activity lookback windows
 * - Per-campaign conversions (30d BM report)
 * - Post-click vs post-view split: only available for CM360 hybrid advertisers
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient } from "@/lib/api-clients/dv360";
import { isDemoCredential } from "@/lib/demo-data";

export const config = { maxDuration: 60 };

function getDemoData() {
  return {
    source: "demo",
    cm360Linked: true,
    configType: "cm360_hybrid" as const,
    floodlightGroupId: "12345678",
    postClickViewAvailable: true,
    activities: [
      { id: "act1", name: "Purchase", clickLookbackDays: 30, viewLookbackDays: 1, servingStatus: "ENABLED" },
      { id: "act2", name: "Add to Cart", clickLookbackDays: 30, viewLookbackDays: 1, servingStatus: "ENABLED" },
      { id: "act3", name: "Lead", clickLookbackDays: 14, viewLookbackDays: 1, servingStatus: "ENABLED" },
    ],
    conversionSplit: [
      { campaign: "Brand Awareness Q2", totalConversions: 1240, postClick: 870, postView: 370 },
      { campaign: "Retargeting - Cart", totalConversions: 680, postClick: 620, postView: 60 },
      { campaign: "Prospecting - Video", totalConversions: 430, postClick: 210, postView: 220 },
    ],
    totals: { totalConversions: 2350, postClick: 1700, postView: 650 },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, clientSecret, refreshToken, advertiserId, partnerId, startDate, endDate } = req.body || {};

  if (!refreshToken || !advertiserId) return res.status(400).json({ error: "Missing refreshToken or advertiserId" });

  if (isDemoCredential(refreshToken)) {
    return res.status(200).json(getDemoData());
  }

  if (!clientId || !clientSecret) return res.status(400).json({ error: "Missing clientId or clientSecret" });

  try {
    const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });

    // 1-2. Unified resolution — config type, group, and Floodlight activities
    //      merged from every available source (CM360 hybrid, DV360-native,
    //      third-party line-item scan, CM360 API for names).
    const resolved = await client.resolveFloodlight();
    const cm360Linked = resolved.configType === "cm360_hybrid";
    const floodlightGroupId = resolved.group?.id ?? resolved.cm360.floodlightConfigId ?? null;

    const activities = resolved.activities.map((a) => ({
      id: a.id,
      name: a.name,
      clickLookbackDays: a.clickLookbackDays,
      viewLookbackDays: a.viewLookbackDays,
      servingStatus: a.servingStatus,
    }));

    // 3. Per-campaign conversions via Bid Manager
    const now = new Date();
    const end = (endDate as string) || now.toISOString().slice(0, 10);
    const start = (startDate as string) || new Date(now.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);

    let conversionSplit: Array<{ campaign: string; campaignId?: string; totalConversions: number; postClick: number; postView: number }> = [];
    let totals = { totalConversions: 0, postClick: 0, postView: 0 };
    let postClickViewAvailable = false;

    // Bid Manager exposes the post-click / post-view split directly (no CM360
    // API needed). Try the split metrics first; if the combination is rejected
    // (HTTP 400), fall back to total conversions only.
    const SPLIT_METRICS = ["METRIC_TOTAL_CONVERSIONS", "METRIC_POST_CLICK_CONVERSIONS", "METRIC_POST_VIEW_CONVERSIONS"];
    const CORE_METRICS = ["METRIC_TOTAL_CONVERSIONS"];

    const runReport = async (metrics: string[]) =>
      client.runBidManagerReport({ startDate: start, endDate: end, dimensions: ["FILTER_MEDIA_PLAN"], metrics }, 45_000);

    try {
      let usedSplit = true;
      let result;
      try {
        result = await runReport(SPLIT_METRICS);
      } catch (splitErr) {
        const msg = splitErr instanceof Error ? splitErr.message : String(splitErr);
        if (/HTTP 400|not supported|combination|invalid/i.test(msg)) {
          console.warn("[DV360 Attr] split metrics rejected, retrying with core:", msg);
          usedSplit = false;
          result = await runReport(CORE_METRICS);
        } else {
          throw splitErr;
        }
      }

      if (result.status === "done" && result.rows) {
        if (result.rows.length > 0) {
          console.log("[DV360 Attr] BM CSV columns:", Object.keys(result.rows[0]).join(", "));
        }
        conversionSplit = result.rows.map((row) => {
          const keys = Object.keys(row);
          // Prefer a name column (not the "... ID" one); keep the raw value as
          // the fallback so we can map IDs → names afterwards.
          const nameKey = keys.find((k) => /(campaign|media.?plan)/i.test(k) && !/id/i.test(k));
          const idKey = keys.find((k) => /(campaign|media.?plan).*id/i.test(k));
          const totalKey = keys.find((k) => /total.?conv/i.test(k));
          const clickKey = keys.find((k) => /post.?click.?conv/i.test(k));
          const viewKey = keys.find((k) => /post.?view.?conv/i.test(k));
          const rawName = nameKey ? String(row[nameKey]) : "";
          const rawId = idKey ? String(row[idKey]) : (nameKey ? String(row[nameKey]) : "");
          const total = totalKey ? Number(row[totalKey]) || 0 : 0;
          const postClick = clickKey ? Number(row[clickKey]) || 0 : 0;
          const postView = viewKey ? Number(row[viewKey]) || 0 : 0;
          return { campaign: rawName || rawId || "Unknown", campaignId: rawId, totalConversions: total, postClick, postView };
        }).filter((r) => r.totalConversions > 0);

        // Resolve campaign IDs → display names from the DV360 entity API when
        // the BM report only gave us numeric IDs.
        const needsNames = conversionSplit.some((r) => /^\d+$/.test(r.campaign));
        if (needsNames) {
          try {
            const campaigns = await client.listCampaigns();
            const nameById = new Map(campaigns.map((c) => [String(c.campaignId), c.displayName]));
            conversionSplit = conversionSplit.map((r) => ({
              ...r,
              campaign: (r.campaignId ? nameById.get(r.campaignId) : undefined) || nameById.get(r.campaign) || r.campaign,
            }));
          } catch (e) {
            console.warn("[DV360 Attr] campaign name resolution failed:", e instanceof Error ? e.message : e);
          }
        }

        totals = conversionSplit.reduce(
          (acc, r) => ({
            totalConversions: acc.totalConversions + r.totalConversions,
            postClick: acc.postClick + r.postClick,
            postView: acc.postView + r.postView,
          }),
          { totalConversions: 0, postClick: 0, postView: 0 }
        );

        // Split is genuinely available only when the split metrics ran AND
        // the numbers actually add up (some accounts return zeros for these).
        postClickViewAvailable = usedSplit && (totals.postClick + totals.postView) > 0;
      }
    } catch (bmErr) {
      console.warn("DV360 attribution BM report failed:", bmErr instanceof Error ? bmErr.message : bmErr);
    }

    return res.status(200).json({
      source: "live",
      cm360Linked,
      floodlightGroupId,
      configType: resolved.configType,
      cm360: resolved.cm360,
      postClickViewAvailable,
      activities,
      conversionSplit,
      totals,
      notes: resolved.notes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("DV360 attribution audit failed:", message);
    return res.status(502).json({ error: message });
  }
}
