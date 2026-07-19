import type { NextApiRequest, NextApiResponse } from "next";
import { DV360ApiClient, type DV360Audience } from "@/lib/api-clients/dv360";
import { isDemoCredential } from "@/lib/demo-data";
import { audienceCache } from "@/lib/report-cache";

export interface DV360AudienceRow {
  id: string;
  name: string;
  type: string;
  source: string;
  description: string;
  membershipDays: number | null;
  activeSize: string;
}

export interface DV360TargetingRow {
  lineItem: string;
  lineItemId: string;
  category: string;
  details: string[];
  source?: "line_item" | "insertion_order"; // where the targeting is set
}

const DEMO_AUDIENCES: DV360AudienceRow[] = [
  { id: "aud-1", name: "All Converters (30d)", type: "First Party", source: "Activity Based", description: "Users who completed a purchase in the last 30 days", membershipDays: 30, activeSize: "100K–500K" },
  { id: "aud-2", name: "Cart Abandoners", type: "First Party", source: "Activity Based", description: "Users who added to cart but didn't purchase", membershipDays: 14, activeSize: "500K–1M" },
  { id: "aud-3", name: "Customer Match — Email List", type: "First Party", source: "Customer Match", description: "CRM email list upload", membershipDays: 540, activeSize: "50K–100K" },
  { id: "aud-4", name: "In-Market: Health & Fitness", type: "Third Party", source: "Google", description: "Google in-market audience segment", membershipDays: null, activeSize: "10M–50M" },
  { id: "aud-5", name: "Affinity: Health Foods Enthusiasts", type: "Third Party", source: "Google", description: "Google affinity audience", membershipDays: null, activeSize: "50M–100M" },
];

const SIZE_MAP: Record<string, string> = {
  AUDIENCE_SIZE_RANGE_UNSPECIFIED: "Unknown",
  AUDIENCE_SIZE_RANGE_1_TO_100: "<100",
  AUDIENCE_SIZE_RANGE_100_TO_1000: "100–1K",
  AUDIENCE_SIZE_RANGE_1000_TO_10000: "1K–10K",
  AUDIENCE_SIZE_RANGE_10000_TO_100000: "10K–100K",
  AUDIENCE_SIZE_RANGE_100000_TO_500000: "100K–500K",
  AUDIENCE_SIZE_RANGE_500000_TO_1000000: "500K–1M",
  AUDIENCE_SIZE_RANGE_1000000_TO_5000000: "1M–5M",
  AUDIENCE_SIZE_RANGE_5000000_TO_10000000: "5M–10M",
  AUDIENCE_SIZE_RANGE_10000000_TO_50000000: "10M–50M",
  AUDIENCE_SIZE_RANGE_50000000_TO_100000000: "50M–100M",
  AUDIENCE_SIZE_RANGE_OVER_100000000: ">100M",
};

function friendlyType(t: string): string {
  if (t.includes("FIRST_PARTY")) return "First Party";
  if (t.includes("THIRD_PARTY")) return "Third Party";
  return t.replace(/FIRST_AND_THIRD_PARTY_AUDIENCE_TYPE_/g, "").replace(/_/g, " ");
}

function friendlySource(s: string): string {
  return (s || "")
    .replace(/^AUDIENCE_SOURCE_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Unspecified", "Unknown");
}

function friendlySize(s?: string): string {
  if (!s) return "Unknown";
  return SIZE_MAP[s] || s.replace(/AUDIENCE_SIZE_RANGE_/g, "").replace(/_/g, " ");
}

const TARGETING_LABELS: Record<string, string> = {
  TARGETING_TYPE_GEO_REGION: "Geography",
  TARGETING_TYPE_AGE_RANGE: "Age",
  TARGETING_TYPE_GENDER: "Gender",
  TARGETING_TYPE_PARENTAL_STATUS: "Parental Status",
  TARGETING_TYPE_HOUSEHOLD_INCOME: "Household Income",
  TARGETING_TYPE_DEVICE_TYPE: "Device",
  TARGETING_TYPE_BROWSER: "Browser",
  TARGETING_TYPE_AUDIENCE_GROUP: "Audience Lists",
  TARGETING_TYPE_DIGITAL_CONTENT_LABEL_EXCLUSION: "Content Exclusions",
  TARGETING_TYPE_LANGUAGE: "Language",
};

function extractDetail(opt: Record<string, unknown>): string {
  const d = opt.assignedTargetingOptionIdValue as string | undefined;
  for (const key of ["geoRegionDetails", "ageRangeDetails", "genderDetails", "parentalStatusDetails", "householdIncomeDetails", "deviceTypeDetails", "browserDetails", "languageDetails", "digitalContentLabelExclusionDetails"]) {
    const detail = opt[key] as Record<string, unknown> | undefined;
    if (detail) {
      const raw = String(
        detail.displayName ?? detail.deviceType ?? detail.ageRange ?? detail.gender ??
        detail.parentalStatus ?? detail.householdIncome ?? detail.contentRatingTier ?? detail.targetingOptionId ?? d ?? "Unknown"
      );
      return raw
        .replace(/^TARGETING_OPTION_/, "")
        .replace(/^AGE_RANGE_/, "")
        .replace(/^GENDER_/, "")
        .replace(/^PARENTAL_STATUS_/, "")
        .replace(/^HOUSEHOLD_INCOME_/, "")
        .replace(/^DEVICE_TYPE_/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
    }
  }
  if (d) {
    return d.replace(/^TARGETING_OPTION_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
  }
  return "Unknown";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ source: "demo" | "live"; audiences: DV360AudienceRow[]; targeting?: DV360TargetingRow[] } | { error: string }>
) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { clientId, clientSecret, refreshToken, advertiserId, partnerId } = req.body || {};
  if (!refreshToken || !advertiserId) return res.status(400).json({ error: "Missing refreshToken or advertiserId" });

  if (isDemoCredential(refreshToken)) {
    return res.status(200).json({ source: "demo", audiences: DEMO_AUDIENCES });
  }
  if (!clientId || !clientSecret) return res.status(400).json({ error: "Missing clientId or clientSecret" });

  // Serve a cached result for this advertiser if we have one (10 min TTL) —
  // the line-item fallback scan is slow, so this makes repeat loads instant.
  const cacheKey = `audiences:${advertiserId}`;
  const cached = audienceCache.get(cacheKey) as
    | { source: "live"; audiences: DV360AudienceRow[]; targeting?: DV360TargetingRow[] }
    | undefined;
  if (cached) return res.status(200).json(cached);

  try {
    const client = new DV360ApiClient({ clientId, clientSecret, refreshToken, advertiserId, partnerId });
    const raw: DV360Audience[] = await client.listAudiences();

    const audiences: DV360AudienceRow[] = raw.map((a) => ({
      id: a.firstAndThirdPartyAudienceId,
      name: a.displayName,
      type: friendlyType(a.audienceType),
      source: friendlySource(a.audienceSource),
      description: a.description || "",
      membershipDays: a.membershipDurationDays ? parseInt(a.membershipDurationDays, 10) : null,
      activeSize: friendlySize(a.activeDisplayAudienceSize),
    }));

    // If no audience lists found, also fetch targeting setup from active line items
    let targeting: DV360TargetingRow[] | undefined;
    if (audiences.length === 0) {
      try {
        const lineItems = await client.listLineItems();
        const active = lineItems
          .filter((li) => li.entityStatus === "ENTITY_STATUS_ACTIVE")
          .slice(0, 2);
        if (active.length === 0) {
          active.push(...lineItems.slice(0, 2));
        }

        // Cache IO-level targeting so we fetch each insertion order once.
        const ioTargetingCache = new Map<string, Record<string, unknown[]>>();
        const getIoTargeting = async (ioId: string) => {
          if (!ioId) return {};
          if (!ioTargetingCache.has(ioId)) {
            ioTargetingCache.set(ioId, await client.listInsertionOrderAllTargeting(ioId));
          }
          return ioTargetingCache.get(ioId)!;
        };

        // Fetch line-item AND parent insertion-order targeting in parallel.
        // Demographics/geo are frequently set on the IO and inherited by LIs —
        // the LI endpoint doesn't return inherited targeting, so we merge both
        // and label each row by where it's actually set.
        const results = await Promise.all(
          active.map(async (li) => {
            const [liTargeting, ioTargeting] = await Promise.all([
              client.listLineItemAllTargeting(li.lineItemId),
              getIoTargeting(li.insertionOrderId),
            ]);
            const rows: DV360TargetingRow[] = [];
            const seenTypes = new Set<string>();
            for (const [type, opts] of Object.entries(liTargeting)) {
              const label = TARGETING_LABELS[type] || type.replace("TARGETING_TYPE_", "").replace(/_/g, " ");
              rows.push({
                lineItem: li.displayName, lineItemId: li.lineItemId, category: label,
                details: (opts as Record<string, unknown>[]).map(extractDetail), source: "line_item",
              });
              seenTypes.add(type);
            }
            // Add IO-level targeting for dimensions the line item doesn't set itself.
            for (const [type, opts] of Object.entries(ioTargeting)) {
              if (seenTypes.has(type)) continue;
              const label = TARGETING_LABELS[type] || type.replace("TARGETING_TYPE_", "").replace(/_/g, " ");
              rows.push({
                lineItem: li.displayName, lineItemId: li.lineItemId, category: label,
                details: (opts as Record<string, unknown>[]).map(extractDetail), source: "insertion_order",
              });
            }
            return rows;
          })
        );
        targeting = results.flat();
      } catch (e) {
        console.error("DV360 targeting fetch failed:", e instanceof Error ? e.message : e);
      }
    }

    const payload = { source: "live" as const, audiences, targeting };
    // Only cache a genuinely useful result (don't lock in an empty scan).
    if (audiences.length > 0 || (targeting?.length ?? 0) > 0) {
      audienceCache.set(cacheKey, payload);
    }
    return res.status(200).json(payload);
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : "Unknown error";
    const message = rawMsg.replace(/<[^>]*>/g, "").slice(0, 200);
    console.error("DV360 audience list failed:", message);
    return res.status(502).json({ error: message });
  }
}
