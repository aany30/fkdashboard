/**
 * POST /api/audit/dv360-config-debug
 *
 * Diagnostic endpoint — dumps the full DV360 advertiser config
 * to help identify how Floodlight / conversion tracking is set up.
 */
import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient } from "@/lib/api-clients/dv360";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, clientSecret, refreshToken, advertiserId, partnerId } = req.body || {};
  if (!clientId || !clientSecret || !refreshToken || !advertiserId)
    return res.status(400).json({ error: "Missing credentials" });

  try {
    const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });

    // 1. Full advertiser config
    const advertiserConfig = await client.getAdvertiserConfig();

    // 2. Try to find Floodlight group via standard detection
    const floodlightGroupId = await client.getFloodlightGroupId();

    // 3. If found, list activities via group
    let activitiesViaGroup: unknown[] = [];
    if (floodlightGroupId) {
      try {
        const effectivePartnerId = partnerId || advertiserId;
        activitiesViaGroup = await client.listFloodlightActivities(floodlightGroupId, effectivePartnerId);
      } catch (e) {
        activitiesViaGroup = [{ error: e instanceof Error ? e.message : String(e) }];
      }
    }

    // 4. Line-item-based Floodlight scan (always run for diagnostics)
    let lineItemFloodlight: unknown = null;
    try {
      const usage = await client.getFloodlightUsageFromLineItems();
      lineItemFloodlight = {
        activitiesFound: usage.length,
        activities: usage.map((u) => ({
          activityId: u.activityId,
          lineItemCount: u.lineItemIds.length,
          activeLineItemCount: u.activeLineItemCount,
          postClickLookbackDays: u.postClickLookbackWindowDays,
          postViewLookbackDays: u.postViewLookbackWindowDays,
        })),
      };
    } catch (e) {
      lineItemFloodlight = { error: e instanceof Error ? e.message : String(e) };
    }

    // 4b. Raw targeting dump for active line items + their parent IOs.
    //     Shows exactly what the API returns for every targeting type so we can
    //     tell whether geo/demographics are simply not set vs blocked by access.
    let targetingDump: unknown = null;
    try {
      const lis = await client.listLineItems();
      const active = lis.filter((li) => li.entityStatus === "ENTITY_STATUS_ACTIVE").slice(0, 2);
      const sample = active.length ? active : lis.slice(0, 2);
      targetingDump = await Promise.all(
        sample.map(async (li) => {
          const [liT, ioT] = await Promise.all([
            client.listLineItemAllTargeting(li.lineItemId),
            li.insertionOrderId ? client.listInsertionOrderAllTargeting(li.insertionOrderId) : Promise.resolve({}),
          ]);
          return {
            lineItem: li.displayName,
            lineItemId: li.lineItemId,
            insertionOrderId: li.insertionOrderId,
            lineItemTargetingTypes: Object.keys(liT),
            insertionOrderTargetingTypes: Object.keys(ioT),
          };
        })
      );
    } catch (e) {
      targetingDump = { error: e instanceof Error ? e.message : String(e) };
    }

    // 5. Try listing advertiser's own Floodlight activities directly
    let advertiserActivities: unknown = null;
    try {
      const acts = await client.listAdvertiserFloodlightActivities();
      advertiserActivities = acts;
    } catch (e) {
      advertiserActivities = { error: e instanceof Error ? e.message : String(e) };
    }

    // 6. Also try listing floodlight groups directly (partner-level)
    let floodlightGroups: unknown = null;
    try {
      const token = await (client as any).getAccessToken();
      const effectivePartnerId = partnerId || (advertiserConfig as any)?.partnerId || advertiserId;
      const urls = [
        `https://displayvideo.googleapis.com/v2/floodlightGroups?partnerId=${effectivePartnerId}`,
        `https://displayvideo.googleapis.com/v4/floodlightGroups?partnerId=${effectivePartnerId}`,
      ];
      const results: Record<string, unknown> = {};
      for (const url of urls) {
        try {
          const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          results[url] = { status: r.status, body: r.ok ? await r.json() : await r.text().then(t => t.slice(0, 500)) };
        } catch (e) {
          results[url] = { error: e instanceof Error ? e.message : String(e) };
        }
      }
      floodlightGroups = results;
    } catch (e) {
      floodlightGroups = { error: e instanceof Error ? e.message : String(e) };
    }

    // 7. Token scope introspection — confirms whether dfatrafficking (CM360) was granted
    let tokenScopes: unknown = null;
    try {
      const token = await (client as any).getAccessToken();
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
      const body = await r.json() as { scope?: string; error?: string; error_description?: string };
      const scopes = (body.scope || "").split(" ").filter(Boolean);
      tokenScopes = {
        status: r.status,
        grantedScopes: scopes,
        hasCm360Trafficking: scopes.includes("https://www.googleapis.com/auth/dfatrafficking"),
        hasCm360Reporting: scopes.includes("https://www.googleapis.com/auth/dfareporting"),
        hasDisplayVideo: scopes.includes("https://www.googleapis.com/auth/display-video"),
        hasBidManager: scopes.includes("https://www.googleapis.com/auth/doubleclickbidmanager"),
        error: body.error,
      };
    } catch (e) {
      tokenScopes = { error: e instanceof Error ? e.message : String(e) };
    }

    // 8. CM360 API reachability — full error body for each URL form + version
    let cm360Check: unknown = null;
    try {
      const token = await (client as any).getAccessToken();
      const urls = [
        "https://dfareporting.googleapis.com/dfareporting/v4/userprofiles",
        "https://dfareporting.googleapis.com/dfareporting/v3.5/userprofiles",
        "https://www.googleapis.com/dfareporting/v4/userprofiles",
      ];
      const results: Record<string, unknown> = {};
      for (const url of urls) {
        try {
          const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          const raw = await r.text();
          let parsed: unknown;
          try { parsed = JSON.parse(raw); } catch { parsed = raw.slice(0, 800); }
          results[url] = { status: r.status, body: parsed };
        } catch (e) {
          results[url] = { error: e instanceof Error ? e.message : String(e) };
        }
      }
      cm360Check = results;
    } catch (e) {
      cm360Check = { error: e instanceof Error ? e.message : String(e) };
    }

    return res.status(200).json({
      advertiserConfig,
      detectedFloodlightGroupId: floodlightGroupId,
      activitiesViaGroup,
      targetingDump,
      lineItemFloodlight,
      advertiserActivities,
      floodlightGroups,
      tokenScopes,
      cm360Check,
    });
  } catch (error) {
    return res.status(502).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}
