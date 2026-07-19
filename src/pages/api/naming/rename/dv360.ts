/**
 * Rename a DV360 entity (campaign / insertion order / line item) via the
 * Display & Video 360 API v4 PATCH. Requires the `display-video` OAuth scope
 * (granted at connect time).
 *
 * Body: { clientId, clientSecret, refreshToken, advertiserId, partnerId?,
 *         entityId, newName, kind? }  — kind defaults to "campaign".
 *
 * Demo mode (refresh token starts with `demo-`): no-op success.
 */

import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient } from "@/lib/api-clients/dv360";
import { isDemoCredential } from "@/lib/demo-data";

interface RenameResponse {
  success: boolean;
  source: "live" | "demo";
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RenameResponse | { error: string }>
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const {
    clientId, clientSecret, refreshToken, advertiserId, partnerId,
    entityId, newName, kind,
  } = req.body || {};

  if (!refreshToken || !advertiserId || !entityId || !newName?.trim()) {
    res.status(400).json({ error: "refreshToken, advertiserId, entityId, and newName are required" });
    return;
  }

  // DV360 display names cap at 240 chars.
  if (newName.length > 240) {
    res.status(400).json({ error: "Name exceeds DV360's 240-character limit" });
    return;
  }

  if (isDemoCredential(refreshToken)) {
    res.status(200).json({ success: true, source: "demo" });
    return;
  }
  if (!clientId || !clientSecret) {
    res.status(400).json({ error: "Missing clientId or clientSecret" });
    return;
  }

  const entityKind: "campaign" | "insertionOrder" | "lineItem" =
    kind === "insertionOrder" || kind === "lineItem" ? kind : "campaign";

  try {
    const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });
    const result = await client.renameEntity(entityKind, String(entityId), newName);
    if (!result.success) {
      res.status(502).json({ error: result.error || "DV360 rename failed" });
      return;
    }
    res.status(200).json({ success: true, source: "live" });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "DV360 rename failed" });
  }
}
