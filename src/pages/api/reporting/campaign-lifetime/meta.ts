import type { NextApiRequest, NextApiResponse } from "next";
import { isDemoCredential } from "@/lib/demo-data";

const META_API_BASE = "https://graph.facebook.com/v18.0";

interface LifetimeMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  videoViews: number;
}

function getDemoLifetime(campaignIds: string[]): Record<string, LifetimeMetrics> {
  const out: Record<string, LifetimeMetrics> = {};
  for (const id of campaignIds) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    h = Math.abs(h);
    out[id] = {
      spend: 20000 + (h % 80000),
      impressions: 500000 + (h % 2000000),
      clicks: 8000 + (h % 30000),
      reach: 200000 + (h % 600000),
      videoViews: 3000 + (h % 50000),
    };
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { accessToken, businessId, campaignIds } = req.body || {};
  if (!accessToken || !businessId || !Array.isArray(campaignIds) || campaignIds.length === 0) {
    res.status(400).json({ error: "Missing accessToken, businessId, or campaignIds" });
    return;
  }

  if (isDemoCredential(accessToken)) {
    res.status(200).json({ source: "demo", data: getDemoLifetime(campaignIds) });
    return;
  }

  try {
    const accountPath = businessId.startsWith("act_") ? businessId : `act_${businessId}`;
    const data: Record<string, LifetimeMetrics> = {};

    const batch = campaignIds.slice(0, 50);
    const promises = batch.map(async (cid: string) => {
      const url = new URL(`${META_API_BASE}/${cid}/insights`);
      url.searchParams.set("access_token", accessToken);
      url.searchParams.set("date_preset", "maximum");
      url.searchParams.set("fields", "spend,impressions,clicks,reach,video_play_actions");

      const r = await fetch(url.toString());
      if (!r.ok) return;
      const json = await r.json();
      const row = json?.data?.[0];
      if (!row) return;

      const videoViews = Array.isArray(row.video_play_actions)
        ? row.video_play_actions.reduce((s: number, a: any) => s + (parseFloat(a.value) || 0), 0)
        : 0;

      data[cid] = {
        spend: parseFloat(row.spend) || 0,
        impressions: parseInt(row.impressions, 10) || 0,
        clicks: parseInt(row.clicks, 10) || 0,
        reach: parseInt(row.reach, 10) || 0,
        videoViews,
      };
    });

    await Promise.all(promises);

    console.log(`[meta-lifetime] fetched ${Object.keys(data).length}/${batch.length} campaigns for ${accountPath}`);
    res.status(200).json({ source: "live", data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Meta lifetime insights fetch failed";
    console.error("[meta-lifetime] failed:", message);
    res.status(500).json({ error: message });
  }
}
