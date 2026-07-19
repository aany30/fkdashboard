/**
 * POST /api/reporting/breakdown/youtube-analytics
 *
 * Age & gender breakdowns for DV360 via the YouTube Analytics API.
 * Bid Manager v2 removed YOUTUBE_AUDIENCE report types — the only supported
 * path for demographic data on YouTube inventory is the YT Analytics API
 * (youtubeanalytics.googleapis.com/v2/reports).
 *
 * Requires the refresh token to have been minted with the additional scope:
 *   https://www.googleapis.com/auth/yt-analytics.readonly
 *
 * If the scope is absent, Google returns a 403 "insufficientPermissions" and
 * the route responds 200 { rows: [], missingScope: true } so the UI can show
 * a "reconnect with analytics scope" prompt instead of a hard error.
 *
 * The YouTube Analytics channelId is resolved automatically: we call the
 * YouTube Data API v3 /channels endpoint and use the first channel linked to
 * the authorised account (or the explicitly supplied channelId if provided).
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { isDemoCredential, getDemoDV360Breakdown } from "@/lib/demo-data";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2";
const YT_DATA_BASE = "https://www.googleapis.com/youtube/v3";

// Module-level token cache (same pattern as DV360 client).
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const key = refreshToken;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  const body = await r.json();
  if (!r.ok || !body.access_token) {
    throw new Error(`Token exchange failed: ${body.error_description || body.error || `HTTP ${r.status}`}`);
  }
  const token = body.access_token as string;
  tokenCache.set(key, { token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 });
  return token;
}

const AUTH_ERROR = Symbol("auth_error");     // token lacks the youtube.readonly scope
const API_DISABLED = Symbol("api_disabled"); // YouTube Data API not enabled in the Cloud project

/** A 403 whose body says the API isn't enabled in the project is NOT a scope
 *  problem — it needs the API turned on in the Cloud console. */
function isApiDisabled(body: string): boolean {
  return /has not been used in project|accessNotConfigured|SERVICE_DISABLED|it is disabled/i.test(body);
}

/**
 * Resolve the YouTube channel ID for the authenticated account.
 * Returns API_DISABLED if the YouTube Data API isn't enabled in the project,
 * AUTH_ERROR if the token lacks the youtube.readonly scope,
 * null if authenticated but no channel is linked, or the channelId string.
 */
async function resolveChannelId(token: string): Promise<string | null | typeof AUTH_ERROR | typeof API_DISABLED> {
  const r = await fetch(
    `${YT_DATA_BASE}/channels?part=id&mine=true&maxResults=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (r.status === 403) {
    const body = await r.text();
    console.warn("YT channel lookup 403:", body.slice(0, 300));
    return isApiDisabled(body) ? API_DISABLED : AUTH_ERROR;
  }
  if (!r.ok) {
    const body = await r.text();
    console.warn(`YT channel lookup failed (HTTP ${r.status}):`, body.slice(0, 300));
    return null;
  }
  const body = await r.json();
  return body.items?.[0]?.id ?? null;
}

interface BreakdownRow {
  label: string;
  breakdownValues: Record<string, string>;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    | { source: "demo" | "live"; rows: BreakdownRow[]; missingScope?: boolean; apiDisabled?: boolean; noChannel?: boolean }
    | { error: string }
  >
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, clientSecret, refreshToken, channelId: explicitChannelId, breakdown, startDate, endDate } =
    req.body || {};

  if (!refreshToken) return res.status(400).json({ error: "Missing refreshToken" });
  if (!["age", "gender"].includes(breakdown)) {
    return res.status(400).json({ error: `YouTube Analytics only supports age and gender breakdowns, got "${breakdown}"` });
  }

  // Demo mode
  if (isDemoCredential(refreshToken)) {
    return res.status(200).json({ source: "demo", rows: getDemoDV360Breakdown(breakdown) as BreakdownRow[] });
  }
  if (!clientId || !clientSecret) return res.status(400).json({ error: "Missing clientId or clientSecret" });

  try {
    const token = await getAccessToken(clientId, clientSecret, refreshToken);

    // Resolve channel — caller can supply one to skip the Data API call.
    const channelResult = explicitChannelId ?? await resolveChannelId(token);
    if (channelResult === API_DISABLED) {
      // YouTube Data API not enabled in the Cloud project — UI shows an
      // "enable the API" prompt (reconnecting won't help).
      return res.status(200).json({ source: "live", rows: [], apiDisabled: true });
    }
    if (channelResult === AUTH_ERROR) {
      // Token lacks youtube.readonly scope — tell UI to prompt for reconnect.
      return res.status(200).json({ source: "live", rows: [], missingScope: true });
    }
    const channelId = channelResult;
    if (!channelId) {
      // Authenticated but the connected account doesn't own a YouTube channel.
      // YouTube's API has no endpoint to list channels you manage-but-don't-own —
      // tell the UI so it can prompt the user to connect the channel owner's account.
      return res.status(200).json({ source: "live", rows: [], noChannel: true });
    }

    // YouTube Analytics dimensions and metrics:
    //   age    → dimension "ageGroup"   → header "ageGroup"
    //   gender → dimension "gender"     → header "gender"
    // Metrics: views (proxy for impressions on YouTube), estimatedMinutesWatched,
    //          averageViewDuration — no cost data available via YT Analytics.
    const dimension = breakdown === "age" ? "ageGroup" : "gender";
    const metricsParam = "views,estimatedMinutesWatched,likes,comments";

    const url = `${YT_ANALYTICS_BASE}/reports?` + new URLSearchParams({
      ids: `channel==${channelId}`,
      startDate,
      endDate,
      dimensions: dimension,
      metrics: metricsParam,
      maxResults: "50",
    }).toString();

    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await r.json();

    // Any 403 from the Analytics API → API disabled, missing scope, or account
    // not configured. Distinguish "API not enabled" so the UI shows the right fix.
    if (r.status === 403) {
      const raw = JSON.stringify(body);
      console.warn("YouTube Analytics 403:", raw.slice(0, 200));
      if (isApiDisabled(raw)) {
        return res.status(200).json({ source: "live", rows: [], apiDisabled: true });
      }
      return res.status(200).json({ source: "live", rows: [], missingScope: true });
    }
    if (!r.ok) {
      throw new Error(`YouTube Analytics API failed (HTTP ${r.status}): ${JSON.stringify(body).slice(0, 300)}`);
    }

    // Response shape: { columnHeaders: [{name}], rows: [[val, val, ...]] }
    const headers: string[] = (body.columnHeaders ?? []).map((h: { name: string }) => h.name);
    const dimIdx = headers.indexOf(dimension);
    const viewsIdx = headers.indexOf("views");

    const rawRows: unknown[][] = body.rows ?? [];
    const out: BreakdownRow[] = rawRows.map((row) => {
      const label = String(row[dimIdx] ?? "");
      const views = dimIdx >= 0 && viewsIdx >= 0 ? Number(row[viewsIdx]) || 0 : 0;
      return {
        label: formatDemLabel(label, breakdown as "age" | "gender"),
        breakdownValues: { [breakdown]: label },
        spend: 0,           // YT Analytics has no spend data
        impressions: views, // views as impressions proxy
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
      };
    }).filter((r) => r.label !== "");

    return res.status(200).json({ source: "live", rows: out });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("YouTube Analytics breakdown failed:", message);
    return res.status(502).json({ error: message });
  }
}

/** Normalise YouTube Analytics label strings into human-readable names. */
function formatDemLabel(raw: string, breakdown: "age" | "gender"): string {
  if (breakdown === "gender") {
    const map: Record<string, string> = { male: "Male", female: "Female", gender_other: "Other" };
    return map[raw.toLowerCase()] ?? raw;
  }
  // Age: "age13-17" → "13–17", "age65-" → "65+"
  const m = raw.match(/age(\d+)[_-](\d+)?/i);
  if (m) return m[2] ? `${m[1]}–${m[2]}` : `${m[1]}+`;
  return raw;
}
