/**
 * Marketing-meaning audience classification.
 *
 * Replaces brittle regex-on-ad-set-name parsing with rules driven by Meta's
 * actual targeting setup (`targeting_spec`, custom-audience `subtype`,
 * campaign objective, promoted_object). When the API doesn't return enough
 * info (Advantage+ Shopping hides targeting), falls back to name parsing and
 * marks the result with source: "name-fallback" so the UI can flag it.
 */

export type AudienceClass =
  | "Broad"
  | "Advantage+ Audience"
  | "Interest"
  | "Lookalike"
  | "Retargeting — Website"
  | "Retargeting — Engagement"
  | "Retargeting — App"
  | "Customer List"
  | "Mixed Custom"
  | "ASC / Shopping"
  | "Catalog/DPA"
  | "Unclassified";

export type FunnelStage = "TOF" | "MOF" | "BOF" | "Loyalty";
export type IntentBucket = "Discovery" | "Consideration" | "Purchase Intent" | "Loyalty";
export type NewVsExisting = "New" | "Engaged" | "Existing";

export interface AudienceClassification {
  cls: AudienceClass;
  funnelStage: FunnelStage;
  intent: IntentBucket;
  newVsExisting: NewVsExisting;
  source: "api" | "name-fallback";
  detail?: string;
}

export interface CustomAudienceDetail {
  id: string;
  name: string;
  size: number;
  subtype?: string;
  lookalikeSpec?: { ratio?: number; type?: string; origin?: any[]; startingAudienceSize?: number };
  customerFileSource?: string;
  timeUpdated?: string;
  /** Number of days a user stays in the audience (website/engagement/app
   *  audiences only). Real Meta field `retention_days`. Undefined for
   *  lookalikes and customer-list audiences (no retention window). */
  retentionDays?: number;
}

export interface AdSetTargeting {
  interests?: any[];
  behaviors?: any[];
  life_events?: any[];
  custom_audiences?: Array<{ id: string; name?: string }>;
  excluded_custom_audiences?: Array<{ id: string; name?: string }>;
  flexible_spec?: Array<{ interests?: any[]; behaviors?: any[]; life_events?: any[] }>;
  geo_locations?: any;
  age_min?: number;
  age_max?: number;
  genders?: number[];
  targeting_automation?: { advantage_audience?: number };
  locales?: number[];
}

const STAGE_TO_INTENT: Record<FunnelStage, IntentBucket> = {
  TOF: "Discovery",
  MOF: "Consideration",
  BOF: "Purchase Intent",
  Loyalty: "Loyalty",
};

const STAGE_TO_NEW_VS_EXISTING: Record<FunnelStage, NewVsExisting> = {
  TOF: "New",
  MOF: "Engaged",
  BOF: "Existing",
  Loyalty: "Existing",
};

const CLASS_TO_STAGE: Record<AudienceClass, FunnelStage> = {
  Broad: "TOF",
  "Advantage+ Audience": "TOF",
  Interest: "TOF",
  Lookalike: "TOF",
  "Retargeting — Website": "MOF",
  "Retargeting — Engagement": "MOF",
  "Retargeting — App": "MOF",
  "Customer List": "Loyalty",
  "Mixed Custom": "MOF",
  "ASC / Shopping": "TOF",
  "Catalog/DPA": "BOF",
  Unclassified: "TOF",
};

/** Shared color map — keyed by AudienceClass so all tabs render consistently. */
export const AUDIENCE_COLORS: Record<AudienceClass, string> = {
  Broad:                       "bg-sky-100 text-sky-800",
  "Advantage+ Audience":       "bg-cyan-100 text-cyan-800",
  Interest:                    "bg-blue-100 text-blue-800",
  Lookalike:                   "bg-indigo-100 text-indigo-800",
  "Retargeting — Website":     "bg-violet-100 text-violet-800",
  "Retargeting — Engagement":  "bg-fuchsia-100 text-fuchsia-800",
  "Retargeting — App":         "bg-purple-100 text-purple-800",
  "Customer List":             "bg-green-100 text-green-800",
  "Mixed Custom":              "bg-rose-100 text-rose-800",
  "ASC / Shopping":            "bg-amber-100 text-amber-800",
  "Catalog/DPA":               "bg-orange-100 text-orange-800",
  Unclassified:                "bg-gray-100 text-gray-600",
};

export const STAGE_COLORS: Record<FunnelStage, string> = {
  TOF:     "bg-blue-100 text-blue-800",
  MOF:     "bg-yellow-100 text-yellow-800",
  BOF:     "bg-orange-100 text-orange-800",
  Loyalty: "bg-green-100 text-green-800",
};

export const INTENT_COLORS: Record<IntentBucket, string> = {
  Discovery:         "bg-blue-100 text-blue-800",
  Consideration:     "bg-purple-100 text-purple-800",
  "Purchase Intent": "bg-orange-100 text-orange-800",
  Loyalty:           "bg-green-100 text-green-800",
};

export const TYPE_COLORS: Record<NewVsExisting, string> = {
  New:      "bg-blue-100 text-blue-800",
  Engaged:  "bg-yellow-100 text-yellow-800",
  Existing: "bg-green-100 text-green-800",
};

function hasInterestSignals(t: AdSetTargeting): boolean {
  if ((t.interests?.length ?? 0) > 0) return true;
  if ((t.behaviors?.length ?? 0) > 0) return true;
  if ((t.life_events?.length ?? 0) > 0) return true;
  for (const f of t.flexible_spec || []) {
    if ((f.interests?.length ?? 0) > 0) return true;
    if ((f.behaviors?.length ?? 0) > 0) return true;
    if ((f.life_events?.length ?? 0) > 0) return true;
  }
  return false;
}

function subtypeToClass(subtype: string): AudienceClass | null {
  const s = subtype.toUpperCase();
  if (s === "LOOKALIKE") return "Lookalike";
  if (s === "WEBSITE" || s === "WEB" || s === "PIXEL") return "Retargeting — Website";
  if (s === "ENGAGEMENT" || s === "VIDEO" || s === "IG_BUSINESS" || s === "PAGE") return "Retargeting — Engagement";
  if (s === "APP") return "Retargeting — App";
  if (s === "CUSTOMER_LIST" || s === "FILE_IMPORTED" || s === "PARTNER") return "Customer List";
  return null;
}

function classifyByCustomAudiences(
  audIds: string[],
  audienceMap: Map<string, CustomAudienceDetail>
): { cls: AudienceClass; detail?: string } | null {
  if (audIds.length === 0) return null;
  const classes = new Set<AudienceClass>();
  const lalDetails: string[] = [];
  for (const id of audIds) {
    const aud = audienceMap.get(id);
    if (!aud?.subtype) continue;
    const c = subtypeToClass(aud.subtype);
    if (c) {
      classes.add(c);
      if (c === "Lookalike" && aud.lookalikeSpec?.ratio) {
        lalDetails.push(`${Math.round(aud.lookalikeSpec.ratio * 100)}%`);
      }
    }
  }
  if (classes.size === 0) return null;
  if (classes.size > 1) return { cls: "Mixed Custom", detail: Array.from(classes).join(" + ") };
  const cls = Array.from(classes)[0];
  const detail = cls === "Lookalike" && lalDetails.length ? `LAL ${lalDetails.join(", ")}` : undefined;
  return { cls, detail };
}

/** Name-based fallback — kept for ad sets where Meta hid targeting.
 *  Returns null when no marketing-meaningful keyword matches (so we can mark
 *  the result Unclassified rather than guessing from a trailing token). */
export function classifyByName(name: string): AudienceClass | null {
  const n = name.toLowerCase();
  if (/\blal\b|look.?alike/.test(n)) return "Lookalike";
  if (/interest|behav|affin/.test(n)) return "Interest";
  if (/\bbroad\b|\bopen\b|gw_all|gw-all|_all_/.test(n)) return "Broad";
  if (/\basa\b|advantage.shopping|\basc\b/.test(n)) return "ASC / Shopping";
  if (/dpa|catalog|dynamic.product/.test(n)) return "Catalog/DPA";
  if (/customer|loyal|existing|\bvip\b/.test(n)) return "Customer List";
  if (/visitor|website|\bweb\b|app visitor/.test(n)) return "Retargeting — Website";
  if (/video|\big\b|instagram|engaged|engage/.test(n)) return "Retargeting — Engagement";
  if (/retarg|remark/.test(n)) return "Retargeting — Website";
  return null;
}

/** Main classifier — single source of truth. */
export function classifyAdSet(
  targeting: AdSetTargeting | undefined,
  audienceMap: Map<string, CustomAudienceDetail>,
  campaignObjective: string | undefined,
  adSetName: string,
): AudienceClassification {
  // ---- API-based path ----
  if (targeting) {
    const audIds = (targeting.custom_audiences || []).map((a) => a.id);
    const customCls = classifyByCustomAudiences(audIds, audienceMap);

    if (customCls) {
      return buildClassification(customCls.cls, "api", customCls.detail);
    }

    const hasInterests = hasInterestSignals(targeting);
    const isAdvantage = targeting.targeting_automation?.advantage_audience === 1;

    if (hasInterests) {
      return buildClassification("Interest", "api");
    }
    // No interests, no custom audiences. Either Broad or Advantage+ Audience.
    if (isAdvantage) {
      return buildClassification("Advantage+ Audience", "api");
    }
    // Sales-objective campaigns with empty targeting are usually ASC.
    if (campaignObjective === "OUTCOME_SALES" && audIds.length === 0 && !hasInterests) {
      return buildClassification("ASC / Shopping", "api", "Targeting opaque (Advantage+ Shopping)");
    }
    return buildClassification("Broad", "api");
  }

  // ---- Name fallback ----
  const guessed = classifyByName(adSetName);
  if (guessed) return buildClassification(guessed, "name-fallback");
  return buildClassification("Unclassified", "name-fallback");
}

function buildClassification(
  cls: AudienceClass,
  source: "api" | "name-fallback",
  detail?: string
): AudienceClassification {
  const stage = CLASS_TO_STAGE[cls];
  return {
    cls,
    funnelStage: stage,
    intent: STAGE_TO_INTENT[stage],
    newVsExisting: STAGE_TO_NEW_VS_EXISTING[stage],
    source,
    detail,
  };
}

/** Convenience: build the audienceMap once per render from an audiences array. */
export function buildAudienceMap(
  audiences: CustomAudienceDetail[] | undefined
): Map<string, CustomAudienceDetail> {
  const m = new Map<string, CustomAudienceDetail>();
  for (const a of audiences || []) m.set(a.id, a);
  return m;
}
