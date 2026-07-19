import type { NextApiRequest, NextApiResponse } from "next";
import { MetaApiClient } from "@/lib/api-clients/meta";
import { isDemoCredential, getDemoMetaCampaigns } from "@/lib/demo-data";
import type { CampaignData } from "@/types";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CampaignData[] | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { accessToken, businessId, startDate, endDate } = req.body;

  if (!accessToken || !businessId) {
    res.status(400).json({ error: "Missing accessToken or businessId" });
    return;
  }

  // Demo token → return demo campaigns directly
  if (isDemoCredential(accessToken)) {
    res.status(200).json(getDemoMetaCampaigns());
    return;
  }

  try {
    const client = new MetaApiClient(accessToken);
    const campaigns = await client.listCampaigns(businessId, startDate, endDate);
    console.log(`[campaigns/meta] ${campaigns?.length ?? 0} campaigns, currency=${campaigns?.[0]?.currency ?? "(none)"}`);
    // Real account that genuinely has no campaigns → return empty (not demo),
    // so the user sees the truth rather than misleading demo data.
    res.status(200).json(campaigns || []);
  } catch (error) {
    // Real token failed (bad/expired token, missing scope, wrong account ID).
    // Surface the actual Graph API error instead of silently showing demo —
    // that masking is exactly why connecting "showed demo data".
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Meta campaigns fetch failed:", message);
    res.status(502).json({ error: message });
  }
}
