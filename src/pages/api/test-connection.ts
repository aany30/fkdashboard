/**
 * Test live connection to Meta / DV360 APIs before saving credentials.
 * Returns granular per-platform status so the UI can show exactly
 * which scope or token is missing.
 */
import type { NextApiRequest, NextApiResponse } from "next";

interface TestResult {
  ok: boolean;
  platform: string;
  message: string;
  details?: string;
  hint?: string;
}

async function testMeta(accessToken: string, businessId: string, pixelIds: string[]): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Test 1: Token validity via /me
  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/me?access_token=${encodeURIComponent(accessToken)}`);
    if (!r.ok) {
      const body = await r.text();
      results.push({
        ok: false,
        platform: "Meta Token",
        message: "Access token rejected",
        details: body.slice(0, 200),
        hint: "Generate a new User or System token from Events Manager > Settings > Access Tokens.",
      });
      return results;
    }
    const me = await r.json();
    results.push({ ok: true, platform: "Meta Token", message: `Authenticated as ${me.name || me.id}` });
  } catch (e: any) {
    results.push({ ok: false, platform: "Meta Token", message: "Network error", details: e.message });
    return results;
  }

  // Test 2: Business access
  try {
    const r = await fetch(
      `https://graph.facebook.com/v18.0/${businessId}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`
    );
    if (!r.ok) {
      const body = await r.text();
      results.push({
        ok: false,
        platform: "Meta Business",
        message: "Cannot access Business ID",
        details: body.slice(0, 200),
        hint: "Ensure your token has business_management permission and you're an admin/employee of this business.",
      });
    } else {
      const b = await r.json();
      results.push({ ok: true, platform: "Meta Business", message: `Connected to "${b.name}"` });
    }
  } catch (e: any) {
    results.push({ ok: false, platform: "Meta Business", message: "Network error", details: e.message });
  }

  // Test 3: Pixel access
  for (const pixelId of pixelIds) {
    try {
      const r = await fetch(
        `https://graph.facebook.com/v18.0/${pixelId}?fields=id,name,is_unavailable&access_token=${encodeURIComponent(accessToken)}`
      );
      if (!r.ok) {
        const body = await r.text();
        results.push({
          ok: false,
          platform: `Pixel ${pixelId}`,
          message: "Cannot access pixel",
          details: body.slice(0, 200),
          hint: "Verify the Pixel ID is correct and the token has ads_management + read_insights permissions on this ad account.",
        });
      } else {
        const p = await r.json();
        results.push({
          ok: true,
          platform: `Pixel ${pixelId}`,
          message: `"${p.name}" — ${p.is_unavailable ? "Unavailable" : "Active"}`,
        });
      }
    } catch (e: any) {
      results.push({ ok: false, platform: `Pixel ${pixelId}`, message: "Network error", details: e.message });
    }
  }

  return results;
}

async function testDV360(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  advertiserId: string
): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Test 1: refresh -> access token exchange (validates client id/secret/refresh token)
  let accessToken: string | null = null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
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
      results.push({
        ok: false,
        platform: "Google OAuth",
        message: "Refresh token exchange failed",
        details: JSON.stringify(body).slice(0, 250),
        hint: "Check Client ID/Secret match the OAuth client used in OAuth Playground, and that the refresh token hasn't expired (7-day expiry while the app is in 'Testing' status).",
      });
      return results;
    }
    accessToken = body.access_token as string;
    results.push({ ok: true, platform: "Google OAuth", message: "Refresh token valid — access token issued" });
  } catch (e: unknown) {
    results.push({ ok: false, platform: "Google OAuth", message: "Network error", details: e instanceof Error ? e.message : String(e) });
    return results;
  }

  // Test 2: DV360 advertiser access (validates display-video scope + seat)
  try {
    const adv = advertiserId.replace(/[^0-9]/g, "");
    const r = await fetch(`https://displayvideo.googleapis.com/v4/advertisers/${adv}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      const body = await r.text();
      results.push({
        ok: false,
        platform: "DV360 Advertiser",
        message: `Advertiser ${advertiserId} not accessible`,
        details: body.slice(0, 250),
        hint: "Verify the Advertiser ID (from the DV360 URL after /a/) and that your Google account has a DV360 user seat on it. Also confirm the 'Display & Video 360 API' is enabled in your Cloud project.",
      });
    } else {
      const a = await r.json();
      results.push({ ok: true, platform: "DV360 Advertiser", message: `Connected to "${a.displayName || advertiserId}"` });
    }
  } catch (e: unknown) {
    results.push({ ok: false, platform: "DV360 Advertiser", message: "Network error", details: e instanceof Error ? e.message : String(e) });
  }

  // Test 3: Bid Manager reporting scope — list queries (cheap, proves the
  // doubleclickbidmanager scope + API enablement without creating anything).
  try {
    const r = await fetch("https://doubleclickbidmanager.googleapis.com/v2/queries?pageSize=1", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) {
      const body = await r.text();
      results.push({
        ok: false,
        platform: "Bid Manager (reports)",
        message: "Reporting API not accessible",
        details: body.slice(0, 250),
        hint: "Enable the 'DoubleClick Bid Manager API' in your Cloud project and make sure the refresh token was minted with the doubleclickbidmanager scope.",
      });
    } else {
      results.push({ ok: true, platform: "Bid Manager (reports)", message: "Reporting scope OK" });
    }
  } catch (e: unknown) {
    results.push({ ok: false, platform: "Bid Manager (reports)", message: "Network error", details: e instanceof Error ? e.message : String(e) });
  }

  return results;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { platform } = req.body || {};

  if (platform === "meta") {
    const { accessToken, businessId, pixelIds } = req.body;
    if (!accessToken || !businessId) {
      return res.status(400).json({ error: "accessToken and businessId required" });
    }
    const results = await testMeta(accessToken, businessId, (pixelIds || []) as string[]);
    return res.status(200).json({ results });
  }

  if (platform === "dv360") {
    const { clientId, clientSecret, refreshToken, advertiserId } = req.body;
    if (!clientId || !clientSecret || !refreshToken || !advertiserId) {
      return res.status(400).json({ error: "clientId, clientSecret, refreshToken, advertiserId required" });
    }
    const results = await testDV360(clientId, clientSecret, refreshToken, advertiserId);
    return res.status(200).json({ results });
  }

  res.status(400).json({ error: "platform must be 'meta' or 'dv360'" });
}
