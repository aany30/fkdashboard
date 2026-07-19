// API Response Types
export interface MetaPixelData {
  pixelId: string;
  status: "active" | "inactive";
  eventCount: number;
  eventFiringConsistency: number; // percentage
  duplicateEvents: number;
  averageLatency: number; // ms
  matchRate: number; // percentage
  lastUpdated: Date;
}

export interface EMQMetrics {
  emailHashQuality: number;
  phoneHashQuality: number;
  externalIdCoverage: number;
  ipUserAgentAvailability: number;
  overallScore: number;
}

export interface FunnelStage {
  stage: "pageview" | "viewContent" | "addToCart" | "initiate_checkout" | "purchase";
  count: number;
  conversionRate: number;
}

export interface AuditIssue {
  id: string;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  status: "needs_fix" | "in_progress" | "fixed" | "monitoring";
  estimatedImpact: number; // percentage
  recommendation: string;
  createdAt: Date;
}

export interface HealthScore {
  overall: number;
  pixelHealth?: number;
  emqScore?: number;
  capiHealth?: number;
  funnelHealth?: number;
  attributionScore?: number;
  conversionHealth?: number;
  status: "healthy" | "moderate" | "critical";
  lastUpdated: Date;
  trend?: number; // percentage change
}

export interface DashboardMetrics {
  platformHealth: {
    meta?: number;
    google?: number;
    linkedin?: number;
  };
  conversionRate: number;
  dataQuality: number;
  issues: AuditIssue[];
  recommendations: Recommendation[];
}

export interface Recommendation {
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  issue: string;
  impact: number; // estimated improvement %
  action: string;
  effort: "quick" | "medium" | "complex";
}

// Credential Types
export interface MetaCredentials {
  accessToken: string;
  businessId: string;
  pixelIds: string[];
}

// Date Range
export type DateRange = "7d" | "30d" | "90d" | "custom";

export interface CustomDateRange {
  startDate: Date;
  endDate: Date;
}

// Naming Convention Types
export interface NamingRule {
  id: string;
  label: string;
  placeholder: string;
  description: string;
  required: boolean;
  position: number;
  examples?: string[];
  /**
   * UI input type. "select" renders a dropdown built from `examples`.
   * Defaults to "text" when omitted.
   */
  inputType?: "text" | "select";
}

export interface NamingConvention {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  rules: NamingRule[];
  separator: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignData {
  id: string;
  name: string;
  objective?: string;
  status: string;
  platform: "meta" | "dv360";
  createdTime?: string;
  /** ISO timestamp of the last significant edit (Meta `updated_time`). Used to estimate learning-phase triggers. */
  updatedTime?: string;
  /** Campaign end / stop time (ISO). Null/undefined means ongoing. */
  endTime?: string;
  /** DV360 planned flight window (ISO yyyy-mm-dd) from campaignFlight.plannedDates.
   *  Used to explain "no delivery": an active campaign whose flight ended before
   *  (or starts after) the selected window legitimately shows zero spend. */
  flightStart?: string;
  flightEnd?: string;
  /** DV360 all-time delivery (wide fixed lookback, ~15 months), INDEPENDENT of
   *  the selected date range. Recommendations use these so advice is stable
   *  whether the user picks 7d / 30d / 90d. Undefined while the report is still
   *  generating or for Meta. */
  allTimeSpend?: number;
  allTimeImpressions?: number;
  allTimeClicks?: number;
  allTimeConversions?: number;
  /** Budget + spend fields (optional — populated when Insights data is available). */
  dailyBudget?: number;
  lifetimeBudget?: number;
  /** Where the budget is set: "campaign" = CBO (campaign-level budget),
   * "adset" = ABO (budget lives on individual ad sets, dailyBudget here is the
   * sum of active ad-set budgets for display only). */
  budgetLevel?: "campaign" | "adset";
  spend?: number;
  impressions?: number;
  clicks?: number;
  reach?: number;
  /** Average impression frequency (impressions ÷ unique reach). DV360 populates
   * this from a separate Bid Manager REACH report; Meta from reach+impressions. */
  frequency?: number;
  /** DV360 only: true while the async REACH report(s) are still generating, so
   * the UI can show a loading state for reach/frequency instead of a stale 0. */
  reachPending?: boolean;
  conversions?: number;
  conversionValue?: number;
  /** Total video plays (Meta `video_play_actions`). Powers Views + VTR in the
   * Planning report. Undefined for non-video campaigns / DV360. */
  videoViews?: number;
  /** 0-100, DV360 only. */
  impressionShare?: number;
  /** ISO currency code: "USD", "INR", etc. */
  currency?: string;
  /**
   * Ad sets nested under the campaign, each with its child ads — used by the
   * Naming audit to let users rename ad sets and ads alongside campaigns.
   * Only populated for Meta currently.
   */
  adSets?: Array<AdSetData>;
  /** Human-readable attribution actually used for this campaign's conversions
   * (derived from the most common ad-set `attributionSpec`, or account default).
   * Example: "1d_click + 1d_view" or "7d_click + 1d_view". */
  effectiveAttribution?: string;
  /** Per-window conversion breakdown from Meta's action_attribution_windows API.
   * Populated for Meta campaigns only; undefined for DV360. */
  conv1dClick?: number;
  conv7dClick?: number;
  conv1dView?: number;
}

export interface AdGroupAdData {
  id: string;
  name: string;
  status: string;
}

export interface AdGroupData {
  id: string;
  name: string;
  status: string;
  format?: string;
  ads?: AdGroupAdData[];
}

/** DV360 creative that delivered on a line item (from Bid Manager, with real
 *  per-creative delivery metrics). */
export interface CreativeData {
  id: string;
  name: string;
  type?: string;
  impressions?: number;
  clicks?: number;
  spend?: number;
}

/** DV360 bid strategy on a Line Item. Exactly one of the three fields will be set. */
export interface DV360BidStrategy {
  type: "fixed" | "maximize_spend" | "performance_goal";
  /** Human-readable label, e.g. "Target CPA" or "Maximize Spend" */
  label: string;
  /** Target value in account currency (e.g. CPA target ₹500, or CPM cap) */
  targetAmount?: number;
  /** Raw performanceGoalType string from the API */
  goalType?: string;
}

export interface AdData {
  id: string;
  name: string;
  status: string;
  spend?: number;
  impressions?: number;
  clicks?: number;
  reach?: number;
  conversions?: number;
  /** DV360 only — this row is a Line Item; its type (display/video/audio/
   * YouTube). Present when the parent "ad set" slot holds an Insertion Order. */
  lineItemType?: string;
  /** DV360 only — Ad Groups nested under this Line Item (YouTube/video). */
  adGroups?: AdGroupData[];
  /** DV360 only — creatives that delivered on this Line Item (display + video). */
  creatives?: CreativeData[];
  /** DV360 only — bid strategy on this Line Item. Undefined for Meta ads. */
  dv360BidStrategy?: DV360BidStrategy;
  /** DV360 only — ISO date of last update (proxy for "days since edit"). */
  updateTime?: string;
  /** DV360 only — line item flight start (ISO yyyy-mm-dd). */
  liFlightStart?: string;
  /** DV360 only — line item flight end (ISO yyyy-mm-dd). */
  liFlightEnd?: string;
}

export interface AdSetData {
  id: string;
  name: string;
  status: string;
  /** Per-ad-set metrics (populated for Meta when insights are returned). */
  spend?: number;
  impressions?: number;
  clicks?: number;
  reach?: number;
  /** Real Meta learning-phase status (LEARNING / LEARNING_LIMITED / SUCCESS).
   * Populated only for Meta ad sets via `learning_stage_info` field. */
  learningStatus?: "LEARNING" | "LEARNING_LIMITED" | "SUCCESS" | string;
  /** Unix timestamp of the last significant edit that restarted learning. */
  lastSigEditTs?: number;
  /** The exact event Meta counts toward the 50-event learning threshold
   * (OFFSITE_CONVERSIONS, LEAD_GENERATION, LINK_CLICKS, APP_INSTALLS, …). */
  optimizationGoal?: string;
  /** Bid strategy on the ad set (LOWEST_COST_WITHOUT_CAP / COST_CAP / BID_CAP /
   * LOWEST_COST_WITH_BID_CAP). Tells whether a manual cap is constraining delivery. */
  bidStrategy?: string;
  /** Bid/cost cap value, in account currency major units (divided by 100). */
  bidAmount?: number;
  /** Per-ad-set attribution window (Meta's `attribution_spec`). Used to send
   * each campaign's OWN attribution to the Insights edge so conversions match
   * Ads Manager exactly. Example: [{event_type:"CLICK_THROUGH", window_days:1}]. */
  attributionSpec?: Array<{ event_type: string; window_days: number }>;
  ads: AdData[];
}

export interface AdSetData {
  id: string;
  name: string;
  status: string;
}

export interface AdData {
  id: string;
  name: string;
  creativeType?: string;
}

export interface NamingComponent {
  position: number;
  label: string;
  expectedPattern: string;
  actualValue: string | null;
  isPresent: boolean;
  isValid: boolean;
}

export interface NamingComplianceResult {
  campaignId: string;
  campaignName: string;
  platform: "meta" | "dv360";
  status: "compliant" | "non-compliant";
  /** % of REQUIRED components missing (0-100). >65 → non-compliant. */
  missingPct: number;
  components: NamingComponent[];
  suggestions?: string;
}
