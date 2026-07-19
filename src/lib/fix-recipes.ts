/**
 * Static fallback recipes for the "How to fix this" panel.
 *
 * Used when the ANTHROPIC_API_KEY env var is missing (e.g. local dev without
 * AI access) OR when the Claude API call errors out. These are deliberately
 * generic — they don't see the full campaign context. The AI path produces
 * far more specific recommendations using the rich payload.
 */

export interface FixStep {
  action: string;
  links?: Array<{ label: string; url: string }>;
}

export interface FixRecipe {
  title: string;
  platform: "meta" | "dv360" | "both";
  steps: FixStep[];
}

/**
 * Recipes keyed by stable metric IDs that the audit modules pass as
 * `fixContext.metric`. If a key isn't found, the API returns a generic
 * recipe (see `GENERIC_RECIPE` below).
 */
export const FIX_RECIPES: Record<string, FixRecipe> = {
  // ----- Budget -----
  budget_overspending: {
    title: "Stop overspending — your pace is above 105%",
    platform: "both",
    steps: [
      {
        action:
          "Open Ads Manager → All Campaigns and sort by Spend descending to identify which campaigns are driving the overspend.",
        links: [
          {
            label: "Meta Ads Manager",
            url: "https://business.facebook.com/adsmanager/manage/campaigns",
          },
          { label: "Google Ads", url: "https://ads.google.com" },
        ],
      },
      {
        action:
          "For the worst-pacing campaigns, click into each campaign → Edit → Budget. Reduce the daily budget so the projected monthly spend falls back within your target.",
      },
      {
        action:
          "If campaigns are running on Lifetime Budget, switch to Daily Budget for more predictable pacing (Edit → Budget & Schedule → Daily Budget).",
      },
      {
        action:
          "Optional safety net: set a Campaign Spending Limit at the ad account level (Account Settings → Spending Limits).",
        links: [
          {
            label: "Meta Spending Limits",
            url: "https://business.facebook.com/settings/ad-accounts",
          },
        ],
      },
    ],
  },

  budget_low_efficiency: {
    title: "Improve budget efficiency — spend is going to low-ROAS campaigns",
    platform: "both",
    steps: [
      {
        action:
          "In Ads Manager, sort campaigns by ROAS ascending. The bottom quartile is what's dragging your weighted efficiency down.",
      },
      {
        action:
          "Pause campaigns with ROAS below 1.0 (you're losing money). Edit each → Status → Off.",
      },
      {
        action:
          "Reallocate the freed budget to your top 3 ROAS campaigns by increasing their daily budget 20%. Avoid bigger jumps — they trigger the Learning Phase to reset.",
      },
      {
        action:
          "Wait 7 days, then check this audit again. Efficiency Score should rise.",
      },
    ],
  },

  budget_no_scaling_opportunity: {
    title: "No campaigns with room to scale",
    platform: "both",
    steps: [
      {
        action:
          "Identify campaigns with ROAS above account median. In Ads Manager → Reports → ROAS column descending.",
      },
      {
        action:
          "For each winner, check Impression Share (Google) or Auction Insights (Meta). If close to 100%, the audience is saturated — duplicate the campaign with a similar but broader audience.",
      },
      {
        action:
          "If Impression Share is low but the campaign is budget-capped, raise the daily budget 20%.",
      },
    ],
  },

  // ----- Audience -----
  audience_overlap_high: {
    title: "Reduce audience overlap (>30%)",
    platform: "meta",
    steps: [
      {
        action:
          "Open Audiences (business.facebook.com/adsmanager/audiences).",
        links: [
          {
            label: "Meta Audiences",
            url: "https://business.facebook.com/adsmanager/audiences",
          },
        ],
      },
      {
        action:
          "Select 2-5 audiences you suspect overlap → click 'Show Audience Overlap' (top menu).",
      },
      {
        action:
          "For pairs with >30% overlap, decide: (a) merge them into one ad set, or (b) add exclusions to keep them mutually exclusive.",
      },
      {
        action:
          "In each ad set, add the overlapping audiences as 'Exclude' under Audience → Custom Audiences → Exclude.",
      },
    ],
  },

  audience_fatigue: {
    title: "Audience fatigue — frequency too high",
    platform: "meta",
    steps: [
      {
        action:
          "Refresh creative: upload 3-5 new ad variations (image / video / carousel) in Ads Manager → Ad Level → Create Ad.",
      },
      {
        action:
          "Expand the audience: increase age range by 5 years on each side OR add 1-2 broader interest categories.",
      },
      {
        action:
          "If both done and frequency still rises, set a Frequency Cap: Ad Set → Optimization & Delivery → 'Frequency Cap'.",
      },
    ],
  },

  wasted_spend_high: {
    title: "Cut wasted spend",
    platform: "both",
    steps: [
      {
        action:
          "Filter campaigns by 'No conversions in last 7 days' (Ads Manager → Filters → Performance).",
      },
      {
        action:
          "For each: if it's been running >14 days with zero conversions, pause it. The data won't get better.",
      },
      {
        action:
          "For paused campaigns still showing spend, check Ad Schedule and Campaign Budget Limits — paused campaigns can still consume budget if mis-configured.",
      },
    ],
  },

  // ----- Structure -----
  learning_limited: {
    title: "Get campaigns out of Learning Limited",
    platform: "meta",
    steps: [
      {
        action:
          "Find affected ad sets: Ads Manager → Ad Set level → Delivery column. Look for 'Learning Limited' status.",
      },
      {
        action:
          "Each ad set needs 50 conversions in 7 days to exit learning. Either: increase budget so Meta can spend faster, OR broaden the audience.",
      },
      {
        action:
          "Consolidate similar ad sets — merge two ad sets that share 70%+ audience into one. Combined volume helps exit learning.",
      },
      {
        action:
          "Switch optimization to a higher-volume event (e.g. Add to Cart instead of Purchase) until enough Purchase data accumulates.",
      },
    ],
  },

  structure_unclear: {
    title: "Clarify ABO vs CBO structure",
    platform: "both",
    steps: [
      {
        action:
          "Decide a default: CBO (Campaign Budget Optimization) is generally preferred — Meta/Google distribute budget to winning ad sets automatically.",
      },
      {
        action:
          "For each campaign, set Campaign → Edit → toggle 'Campaign Budget Optimization' ON.",
      },
      {
        action:
          "Use ABO only when you specifically need to force-spend on a fixed audience (e.g. brand defense). Label those campaigns with 'ABO' in the name so the audit can detect them.",
      },
    ],
  },

  naming_low_compliance: {
    title: "Lift naming compliance",
    platform: "both",
    steps: [
      {
        action:
          "Open the Naming Convention audit (Campaign → Account Structure → Naming Convention).",
      },
      {
        action:
          "Filter to 'Fail' rows and click 'Fix name' on each failing campaign — the inline editor prefills suggested values from the existing name + campaign objective.",
      },
      {
        action:
          "Apply the suggested name in Meta Ads Manager / Google Ads by clicking into the campaign → Edit → Campaign Name and pasting the corrected name.",
      },
    ],
  },

  // ----- Tracking -----
  pixel_critical: {
    title: "Pixel is critical — events not flowing",
    platform: "meta",
    steps: [
      {
        action:
          "Open Events Manager → click your pixel → Test Events.",
        links: [
          {
            label: "Events Manager",
            url: "https://business.facebook.com/events_manager2",
          },
        ],
      },
      {
        action:
          "Open your site in another tab. Browse to a key page (product detail, checkout). The events should appear in Test Events within seconds.",
      },
      {
        action:
          "If nothing appears: check the pixel base code is present on every page (Settings → Pixel Setup → Manual Installation).",
      },
      {
        action:
          "If events appear but with errors (red rows), click each error to see the specific parameter issue (missing fbc, missing email hash, etc.).",
      },
    ],
  },

  emq_low: {
    title: "Lift Event Match Quality (EMQ < 6)",
    platform: "meta",
    steps: [
      {
        action:
          "In Events Manager → your pixel → Settings → Automatic Advanced Matching → toggle ON.",
        links: [
          {
            label: "Events Manager",
            url: "https://business.facebook.com/events_manager2",
          },
        ],
      },
      {
        action:
          "For CAPI: add hashed user data to every server event — at minimum em (email), ph (phone), external_id. Use SHA-256 lowercase trimmed.",
        links: [
          {
            label: "CAPI customer-info-parameters docs",
            url: "https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters",
          },
        ],
      },
      {
        action:
          "Add fbc and fbp cookies to server events for browser-side correlation (these are auto-set by the pixel; pass them through in your backend).",
      },
      {
        action:
          "Wait 24 hours, then re-check EMQ — it should rise to 7+.",
      },
    ],
  },

  capi_low_dedup: {
    title: "Fix CAPI dedup rate (below 70%)",
    platform: "meta",
    steps: [
      {
        action:
          "The dedup mechanism requires the same `event_id` on both browser pixel and CAPI server event for the same action.",
      },
      {
        action:
          "On your site, generate a unique event_id when each event fires (e.g. uuid). Pass it to both fbq() for browser and your backend.",
      },
      {
        action:
          "In your backend, when sending the CAPI event, include `event_id` in the data payload — same value as the browser sent.",
      },
      {
        action:
          "Verify in Events Manager → Test Events: each event should show 'Browser & Server' with the dedup checkmark.",
      },
    ],
  },

  funnel_leakage_severe: {
    title: "Plug severe funnel leakage",
    platform: "both",
    steps: [
      {
        action:
          "Identify which stage has the worst drop. Open GA4 → Explore → Funnel Exploration and rebuild the funnel: PageView → ViewContent → AddToCart → InitiateCheckout → Purchase.",
        links: [
          { label: "GA4", url: "https://analytics.google.com" },
        ],
      },
      {
        action:
          "For the leaking stage, check the page (e.g. /cart) using a real device. Common culprits: slow load, missing trust signals, broken add-to-cart button.",
      },
      {
        action:
          "Verify the tracking is firing: open the page → DevTools → Network → filter for 'collect' (GA4) or 'facebook' (Pixel). If no event fires, the leak is a tracking issue, not a UX issue.",
      },
    ],
  },

  attribution_dedup_issue: {
    title: "Improve attribution dedup rate",
    platform: "both",
    steps: [
      {
        action:
          "For Meta: same as 'CAPI low dedup' — ensure event_id is shared between browser pixel and CAPI.",
      },
      {
        action:
          "For Google Ads: enable Enhanced Conversions. Tools → Conversions → click your conversion → 'Turn on Enhanced Conversions for Web'.",
        links: [
          {
            label: "Google Ads Conversions",
            url: "https://ads.google.com/aw/conversions",
          },
        ],
      },
      {
        action:
          "For both: verify your consent banner allows tracking before events fire (or use Consent Mode v2 for partial consent).",
      },
    ],
  },

  // ----- Platform: Meta -----
  meta_low_advantage_plus: {
    title: "Increase Advantage+ adoption",
    platform: "meta",
    steps: [
      {
        action:
          "For each ad set: Ad Set → Audience → enable 'Advantage+ Audience' (Meta picks the audience automatically).",
      },
      {
        action:
          "For each ad: Ad → Placements → toggle 'Advantage+ Placements'. Meta will run on Feed, Stories, Reels, etc., based on where it works best.",
      },
      {
        action:
          "Start with one campaign as a test. If it performs at or above your fixed-targeting campaigns over 14 days, roll out broadly.",
      },
    ],
  },

  // ----- Platform: Google -----
  google_low_impression_share: {
    title: "Lift Impression Share (below 60%)",
    platform: "dv360",
    steps: [
      {
        action:
          "Open the Reports tab → 'Auction Insights'. Identify whether you're losing IS to budget cap or rank.",
        links: [
          { label: "Google Ads", url: "https://ads.google.com" },
        ],
      },
      {
        action:
          "If IS Lost (Budget): increase daily budget. The campaign has demand but is capped.",
      },
      {
        action:
          "If IS Lost (Rank): improve Quality Score. Open Keywords → add the Quality Score column → focus on keywords below 5/10. Fix Expected CTR by adding RSA headlines that match the query; fix Landing Page Experience by improving page load + relevance.",
      },
      {
        action:
          "Bid adjustment: switch from Manual CPC to Maximize Conversions or Target CPA — the auto-bidding strategies typically lift IS for conversion-focused goals.",
      },
    ],
  },

  google_pmax_assets_low: {
    title: "Fill PMax asset coverage (below 70%)",
    platform: "dv360",
    steps: [
      {
        action:
          "Open the PMax campaign → Asset Groups → click 'Edit' on the asset group with low coverage.",
      },
      {
        action:
          "Add until every slot is filled: at least 3 long headlines (90 chars), 5 short headlines (30 chars), 5 descriptions, 1 long description, 1 logo, 4 landscape images (1.91:1), 4 square images (1:1), 1 portrait image (4:5), 1 portrait video (9:16), 1 horizontal video (16:9).",
      },
      {
        action:
          "Add audience signals: Asset Group → Audience Signals → upload your customer list, recent purchasers, and define in-market interests.",
      },
      {
        action:
          "Wait 7 days for Google to learn the new assets. Asset Strength should rise to 'Good' or 'Excellent'.",
      },
    ],
  },
};

export const GENERIC_RECIPE: FixRecipe = {
  title: "How to investigate this issue",
  platform: "both",
  steps: [
    {
      action:
        "Open the affected campaign / ad set in Meta Ads Manager or Google Ads. Compare its recent performance to other campaigns in the same account.",
    },
    {
      action:
        "Check the Delivery / Status column for any warnings (Limited Delivery, Rejected, Learning Limited, etc.) — Meta and Google surface most root causes here.",
    },
    {
      action:
        "If the issue is metric-specific (low CTR, high CPM, low ROAS), check the corresponding diagnostic in the platform's reporting view — both platforms expose a 'Recommendations' tab with platform-specific suggestions.",
    },
    {
      action:
        "Configure ANTHROPIC_API_KEY in your environment to get specific, data-aware fix steps for this metric.",
    },
  ],
};

export function getRecipeIdFromMetric(metric: string): string | undefined {
  // Direct match
  if (FIX_RECIPES[metric]) return metric;
  // Case-insensitive match
  const lower = metric.toLowerCase().replace(/[\s-]/g, "_");
  if (FIX_RECIPES[lower]) return lower;
  return undefined;
}

export function getStaticRecipe(metric: string): FixRecipe {
  const id = getRecipeIdFromMetric(metric);
  return id ? FIX_RECIPES[id] : GENERIC_RECIPE;
}
