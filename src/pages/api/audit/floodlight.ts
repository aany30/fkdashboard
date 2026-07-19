/**
 * POST /api/audit/floodlight
 *
 * Returns Floodlight group + activity health for a DV360 advertiser.
 *
 * Live detection uses the unified resolver (client.resolveFloodlight()) which
 * handles ALL three ways Floodlight can be wired and merges what each source
 * contributes:
 *   1. CM360 hybrid   — DV360 floodlightGroups + CM360 API (names).
 *   2. DV360-native   — floodlightGroups.get + activities list (names).
 *   3. Third-party    — line-item conversionCounting (IDs + lookback) + CM360
 *      API for names when the account can reach CM360.
 *
 * Daily conversions per activity are layered on via a Bid Manager report
 * grouped by FILTER_FLOODLIGHT_ACTIVITY_ID × FILTER_DATE.
 *
 * Demo: returns getDemoFloodlight() from demo-data.ts.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient } from "@/lib/api-clients/dv360";
import { isDemoCredential, getDemoFloodlight } from "@/lib/demo-data";

export const config = { maxDuration: 60 };

const DAY_MS = 86_400_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, clientSecret, refreshToken, advertiserId, partnerId } = req.body || {};

  if (!refreshToken || !advertiserId) return res.status(400).json({ error: "Missing refreshToken or advertiserId" });

  if (isDemoCredential(refreshToken)) {
    return res.status(200).json({ source: "demo", ...getDemoFloodlight() });
  }

  if (!clientId || !clientSecret) return res.status(400).json({ error: "Missing clientId or clientSecret" });

  try {
    const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });

    const now = new Date();
    const windowEnd = now.toISOString().slice(0, 10);
    const windowStart = new Date(now.getTime() - 13 * DAY_MS).toISOString().slice(0, 10);
    const dayKeys: string[] = Array.from({ length: 14 }, (_, i) =>
      new Date(now.getTime() - (13 - i) * DAY_MS).toISOString().slice(0, 10)
    );

    // ── Unified resolution across all Floodlight connection types ───────────
    const resolved = await client.resolveFloodlight();

    if (resolved.activities.length === 0) {
      return res.status(200).json({
        source: "live",
        group: null,
        activities: [],
        windowStart: null,
        windowEnd: null,
        configType: resolved.configType,
        note: resolved.notes[0] || "No Floodlight configuration found for this advertiser.",
      });
    }

    // ── Daily conversions per activity via Bid Manager ──────────────────────
    const perDay = new Map<string, number[]>(); // activityId -> conversions[14]
    const nameById = new Map<string, string>(); // activityId -> name from CSV (if present)
    const notes = [...resolved.notes];

    try {
      const result = await client.runBidManagerReport(
        {
          dimensions: ["FILTER_FLOODLIGHT_ACTIVITY_ID", "FILTER_DATE"],
          metrics: ["METRIC_TOTAL_CONVERSIONS"],
          startDate: windowStart,
          endDate: windowEnd,
        },
        40_000
      );

      if (result.status === "done") {
        const rows = result.rows;
        if (rows.length > 0) console.log("[Floodlight] BM CSV columns:", Object.keys(rows[0]).join(", "));
        for (const row of rows) {
          const keys = Object.keys(row);
          const idKey = keys.find((k) => /floodlight.*id/i.test(k));
          const nameKey = keys.find((k) => /floodlight/i.test(k) && !/id/i.test(k));
          const dateKey = keys.find((k) => /^date$/i.test(k));
          const convKey = keys.find((k) => /total conversions/i.test(k));
          if (!idKey || !dateKey || !convKey) continue;

          const actId = String(row[idKey]);
          const iso = String(row[dateKey]).replace(/\//g, "-"); // BM dates: YYYY/MM/DD
          const dayIdx = dayKeys.indexOf(iso);
          if (dayIdx < 0) continue;

          if (!perDay.has(actId)) perDay.set(actId, Array(14).fill(0));
          perDay.get(actId)![dayIdx] += Number(row[convKey]) || 0;
          if (nameKey && row[nameKey]) nameById.set(actId, String(row[nameKey]));
        }
      } else {
        notes.push("Conversion trend report timed out — reload the tab to retry.");
      }
    } catch (e) {
      console.warn("[Floodlight] BM activity report failed:", e instanceof Error ? e.message : e);
      notes.push("Daily conversion trend can't be fetched via the Bid Manager API for this advertiser.");
    }

    // ── Merge resolver activities + BM conversions/names into the UI shape ───
    const activities = resolved.activities.map((a) => {
      // Prefer a real name; if the resolver only has a fallback, try the BM CSV.
      const bmName = nameById.get(a.id);
      const name = a.hasRealName ? a.name : (bmName || a.name);
      return {
        id: a.id,
        name,
        type: a.type,
        countingMethod: "STANDARD_COUNTING",
        clickLookbackDays: a.clickLookbackDays,
        viewLookbackDays: a.viewLookbackDays,
        sslRequired: a.sslRequired,
        servingStatus: a.servingStatus,
        lineItemCount: a.lineItemCount,
        activeLineItemCount: a.activeLineItemCount,
        conversions14d: perDay.get(a.id) ?? (Array(14).fill(0) as number[]),
        revenue14d: Array(14).fill(0) as number[],
      };
    });

    // Group label reflects the actual detection path.
    const group =
      resolved.group ??
      (resolved.configType === "third_party"
        ? { id: "third-party", name: "Third-party ad server — activities discovered via line-item conversion tracking" }
        : { id: "resolved", name: "Floodlight activities (resolved)" });

    return res.status(200).json({
      source: "live",
      group,
      configType: resolved.configType,
      detectionPath: resolved.detectionPath,
      cm360: resolved.cm360,
      windowStart,
      windowEnd,
      activities,
      note: notes.length > 0 ? notes.join(" ") : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Floodlight audit failed:", message);
    return res.status(502).json({ error: message });
  }
}
