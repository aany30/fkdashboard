import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DateRange, CustomDateRange, NamingConvention, NamingRule } from "@/types";
import { META_BENCHMARKS, type BenchmarkSnapshot } from "@/lib/funnel-benchmarks";
import { toDisplayCredits } from "@/lib/ai-cost";
import { isDemoCredential } from "@/lib/demo-data";

interface PixelInfo {
  id: string;
  name: string;
}

interface CustomBenchmarks {
  // Meta Benchmarks
  metaEMQScore: number;
  metaDedupRate: number;
  metaCAPIHealthScore: number;
  metaPayloadCompleteness: number;
  metaEventLatencyMs: number;

  // Funnel Benchmarks
  funnelConversionRate: number;
  funnelDropOffThreshold: number;

  // General
  eventFiringHealthThreshold: number;
}

/**
 * Per-match-key benchmark overrides for the EMQ Match-Key Coverage table.
 * Keyed by the canonical row label ("Email Hash", "Phone Number Hash", etc.)
 * or the friendly extra-key label ("First Name (fn)", etc.). Persisted via
 * the existing Zustand `persist` middleware so user edits survive reload.
 */
export interface EmqKeyBenchmark { min: number; max: number }

const DEFAULT_BENCHMARKS: CustomBenchmarks = {
  metaEMQScore: 0.88,
  metaDedupRate: 0.95,
  metaCAPIHealthScore: 0.85,
  metaPayloadCompleteness: 0.9,
  metaEventLatencyMs: 500,
  funnelConversionRate: 0.03,
  funnelDropOffThreshold: 0.3,
  eventFiringHealthThreshold: 0.9,
};

const DEFAULT_NAMING_CONVENTIONS: NamingConvention[] = [
  {
    id: "standard-marketing",
    name: "Standard Marketing Naming",
    description: "Recommended naming convention for marketing campaigns",
    enabled: true,
    separator: " >> ",
    rules: [
      {
        id: "agency",
        label: "Agency Name",
        placeholder: "e.g., Three Zinc, Ecom Agency",
        description: "Your agency or brand name",
        required: false,
        position: 1,
        examples: ["Three Zinc", "Ecom Agency", "In House Team"],
        inputType: "text",
      },
      {
        id: "product",
        label: "Product",
        placeholder: "e.g., Mova, DV360",
        description: "Product or service being promoted",
        required: false,
        position: 2,
        examples: ["Mova", "DV360", "Social Agency"],
        inputType: "text",
      },
      {
        id: "objective",
        label: "Objective/Buy Type",
        placeholder: "Select an objective",
        description: "Campaign objective or buying type",
        required: false,
        position: 3,
        examples: [
          "Awareness . Reach",
          "Awareness . Views",
          "Consideration . Engagement",
          "Consideration . Clicks",
          "Preference . Leads",
          "Preference . Store Visits",
          "Purchase . Sales",
          "Preference . App Installs",
        ],
        inputType: "select",
      },
      {
        id: "platform",
        label: "Platform",
        placeholder: "Select a platform",
        description: "Advertising platform",
        required: false,
        position: 4,
        examples: [
          "Meta",
          "Facebook",
          "Instagram",
          "Google SEM",
          "Google Display",
          "YouTube",
          "DV360",
          "Snapchat",
          "TikTok",
          "X",
          "LinkedIn",
          "Pinterest",
          "Reddit",
        ],
        inputType: "select",
      },
      {
        id: "creative-type",
        label: "Creative Type",
        placeholder: "Select a creative type",
        description: "Type of creative asset",
        required: false,
        position: 5,
        examples: [
          "Static",
          "Carousels",
          "Gif",
          "Video",
        ],
        inputType: "select",
      },
      {
        id: "campaign-name",
        label: "Campaign Name",
        placeholder: "e.g., W1-Promo, Q2-Campaign",
        description: "Specific campaign identifier",
        required: false,
        position: 6,
        examples: ["W1-Promo", "Q2-Campaign", "Summer-Sale", "Launch-2026"],
        inputType: "text",
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

interface AuthState {
  // Alerts — email of the auditor viewing the dashboard (recipient for
  // critical-campaign alerts from Budget Allocation, etc.). Persists across
  // sessions so the user only sets it once.
  alertEmail: string | null;
  // Email of the Google account used to sign in (captured from the DV360 OAuth
  // openid/email scope). Alerts default to this so no manual entry is needed.
  loginEmail: string | null;

  // Optional user-set monthly budget cap (in their account's currency units).
  // Drives the Monthly Budget Tracking card on the Budget Allocation audit —
  // MTD spend vs MTD expected pace, daily cap maths, headroom for new campaigns.
  monthlyBudget: number | null;

  // User-entered current EMQ scores per event (1–10 scale).
  // Persisted in localStorage so they survive page refreshes.
  // Key = event id (e.g. "pageView", "atc"), value = 0–10 or null (not entered).
  emqInputs: Record<string, number | null>;

  // Meta Credentials
  metaAccessToken: string | null;
  metaBusinessId: string | null;
  metaPixelIds: string[];
  metaPixelList: PixelInfo[];
  selectedMetaPixelId: string | null;

  // DV360 Credentials — OAuth client + refresh token minted via OAuth Playground
  // (see DV360Guide). Server exchanges refresh → access token per request.
  dv360ClientId: string | null;
  dv360ClientSecret: string | null;
  dv360RefreshToken: string | null;
  dv360AdvertiserId: string | null;
  dv360PartnerId: string | null;

  // Account currencies, cached once detected so a later rate-limited campaign
  // fetch can't lose the correct symbol (Account Structure fetches reliably;
  // reporting tabs fire many concurrent calls and the campaign fetch can 429).
  metaCurrency: string | null;
  dv360Currency: string | null;
  setMetaCurrency: (c: string) => void;
  setDv360Currency: (c: string) => void;

  // Custom Benchmarks
  customBenchmarks: CustomBenchmarks;

  // Per-row overrides for the EMQ Match-Key Coverage table.
  // Keyed by display label (e.g. "Email Hash", "First Name (fn)").
  emqKeyBenchmarks: Record<string, EmqKeyBenchmark>;
  setEmqKeyBenchmark: (label: string, value: EmqKeyBenchmark) => void;
  resetEmqKeyBenchmark: (label: string) => void;

  // Date Range
  dateRange: DateRange;
  customDateRange: CustomDateRange | null;

  // Naming Conventions
  namingConventions: NamingConvention[];
  activeConventionId: string | null;

  // Funnel Benchmarks
  benchmarkSnapshots: BenchmarkSnapshot[];
  activeBenchmarkId: string;
  addBenchmarkSnapshot: (snapshot: BenchmarkSnapshot) => void;
  setActiveBenchmark: (id: string) => void;
  removeBenchmarkSnapshot: (id: string) => void;

  // Alerts
  setAlertEmail: (email: string | null) => void;
  /** Set the signed-in Google email; defaults alertEmail to it when unset. */
  setLoginEmail: (email: string | null) => void;
  setMonthlyBudget: (amount: number | null) => void;
  setEmqInput: (eventId: string, value: number | null) => void;
  /**
   * AI credits displayed in the header for the currently signed-in account.
   * Always mirrors this account's bucket in `aiCreditsByEmail` — restored on
   * re-login rather than reset, so a user's usage total is never lost.
   */
  totalAiCreditsUsd: number;
  /**
   * Cumulative AI credits (display units) per login email. Persisted, never
   * reset on logout — so re-logging in with the same email restores the total.
   * Keyed by `loginEmail`, or "__local__" for token-only (no-email) sessions.
   */
  aiCreditsByEmail: Record<string, number>;
  addAiCredits: (usd: number) => void;

  // Auth Methods
  setMetaCredentials: (token: string, businessId: string, pixelIds: string[]) => void;
  setMetaPixelList: (pixels: PixelInfo[]) => void;
  setSelectedMetaPixelId: (pixelId: string) => void;

  setDV360Credentials: (creds: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    advertiserId: string;
    partnerId?: string;
  }) => void;
  setDateRange: (range: DateRange) => void;
  setCustomDateRange: (range: CustomDateRange) => void;
  clearMetaCredentials: () => void;
  clearDV360Credentials: () => void;
  clearAllCredentials: () => void;
  addMetaPixelId: (pixelId: string) => void;
  removeMetaPixelId: (pixelId: string) => void;

  // Benchmark Methods
  updateBenchmark: <K extends keyof CustomBenchmarks>(key: K, value: CustomBenchmarks[K]) => void;
  updateAllBenchmarks: (benchmarks: Partial<CustomBenchmarks>) => void;
  resetBenchmarksToDefault: () => void;
  getBenchmark: <K extends keyof CustomBenchmarks>(key: K) => CustomBenchmarks[K];

  // Naming Convention Methods
  addNamingConvention: (convention: NamingConvention) => void;
  updateNamingConvention: (id: string, updates: Partial<NamingConvention>) => void;
  deleteNamingConvention: (id: string) => void;
  setActiveConvention: (id: string) => void;
  getActiveConvention: () => NamingConvention | null;

  // Utility Methods
  isMetaConnected: () => boolean;
  isDV360Connected: () => boolean;
  getDateRangeLabel: () => string;

  // Demo mode — session-only, NOT persisted to localStorage.
  // When true, the dashboard renders demo data without writing fake tokens
  // into localStorage (so other visitors on the same machine / new tabs
  // never accidentally see "Go to Dashboard" or someone else's demo state).
  demoMode: boolean;
  enterDemoMode: () => void;
  exitDemoMode: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      alertEmail: null,
      loginEmail: null,
      monthlyBudget: null,
      emqInputs: {},
      totalAiCreditsUsd: 0,
      aiCreditsByEmail: {},
      demoMode: false,
      enterDemoMode: () => set({ demoMode: true }),
      exitDemoMode: () => set({ demoMode: false }),
      metaAccessToken: null,
      metaBusinessId: null,
      metaPixelIds: [],
      metaPixelList: [],
      selectedMetaPixelId: null,
      dv360ClientId: null,
      dv360ClientSecret: null,
      dv360RefreshToken: null,
      dv360AdvertiserId: null,
      dv360PartnerId: null,
      metaCurrency: null,
      dv360Currency: null,
      setMetaCurrency: (c: string) => { if (c && c !== get().metaCurrency) set({ metaCurrency: c }); },
      setDv360Currency: (c: string) => { if (c && c !== get().dv360Currency) set({ dv360Currency: c }); },
      customBenchmarks: DEFAULT_BENCHMARKS,
      emqKeyBenchmarks: {},
      dateRange: "30d",
      customDateRange: null,
      namingConventions: DEFAULT_NAMING_CONVENTIONS,
      activeConventionId: DEFAULT_NAMING_CONVENTIONS[0].id,

      benchmarkSnapshots: [META_BENCHMARKS],
      activeBenchmarkId: META_BENCHMARKS.id,

      setAlertEmail: (email) => set({ alertEmail: email }),
      setLoginEmail: (email) => set((state) => ({
        loginEmail: email,
        // Default the alert recipient to the login email if the user hasn't set one.
        alertEmail: state.alertEmail ?? email,
        // Restore this email's accumulated AI credits into the header counter.
        totalAiCreditsUsd: (state.aiCreditsByEmail || {})[email || "__local__"] || 0,
      })),
      setMonthlyBudget: (amount) => set({ monthlyBudget: amount }),
      setEmqInput: (eventId, value) =>
        set((state) => ({ emqInputs: { ...state.emqInputs, [eventId]: value } })),
      // Callers pass the RAW Anthropic cost; we store the PRODUCT-priced value
      // (raw × 3 ÷ 0.05) so the counter reflects what the customer is charged.
      // The running total is accumulated per login email (bucketed in
      // aiCreditsByEmail) so it survives logout and is restored on re-login.
      addAiCredits: (usd) =>
        set((state) => {
          const key = state.loginEmail || "__local__";
          const buckets = state.aiCreditsByEmail || {};
          const next = +((buckets[key] || 0) + toDisplayCredits(usd)).toFixed(4);
          return {
            totalAiCreditsUsd: next,
            aiCreditsByEmail: { ...buckets, [key]: next },
          };
        }),

      setMetaCredentials: (token, businessId, pixelIds) =>
        set({ metaAccessToken: token, metaBusinessId: businessId, metaPixelIds: pixelIds }),

      setMetaPixelList: (pixels) =>
        set({ metaPixelList: pixels, selectedMetaPixelId: pixels[0]?.id || null }),

      setSelectedMetaPixelId: (pixelId) =>
        set({ selectedMetaPixelId: pixelId }),

      setDV360Credentials: ({ clientId, clientSecret, refreshToken, advertiserId, partnerId }) =>
        set({
          dv360ClientId: clientId,
          dv360ClientSecret: clientSecret,
          dv360RefreshToken: refreshToken,
          dv360AdvertiserId: advertiserId,
          dv360PartnerId: partnerId || null,
        }),

      setDateRange: (range) => set({ dateRange: range }),
      setCustomDateRange: (range) => set({ customDateRange: range }),

      updateBenchmark: (key, value) =>
        set((state) => ({
          customBenchmarks: { ...state.customBenchmarks, [key]: value },
        })),

      updateAllBenchmarks: (benchmarks) =>
        set((state) => ({
          customBenchmarks: { ...state.customBenchmarks, ...benchmarks },
        })),

      resetBenchmarksToDefault: () =>
        set({ customBenchmarks: DEFAULT_BENCHMARKS }),

      setEmqKeyBenchmark: (label, value) =>
        set((state) => ({ emqKeyBenchmarks: { ...state.emqKeyBenchmarks, [label]: value } })),

      resetEmqKeyBenchmark: (label) =>
        set((state) => {
          const next = { ...state.emqKeyBenchmarks };
          delete next[label];
          return { emqKeyBenchmarks: next };
        }),

      getBenchmark: (key) => {
        const state = get();
        return state.customBenchmarks[key];
      },

      clearMetaCredentials: () =>
        set({
          metaAccessToken: null,
          metaBusinessId: null,
          metaPixelIds: [],
          metaPixelList: [],
          selectedMetaPixelId: null,
          metaCurrency: null,
        }),

      clearDV360Credentials: () =>
        set({
          dv360ClientId: null,
          dv360ClientSecret: null,
          dv360RefreshToken: null,
          dv360AdvertiserId: null,
          dv360PartnerId: null,
          dv360Currency: null,
        }),

      clearAllCredentials: () =>
        set({
          metaAccessToken: null,
          metaBusinessId: null,
          metaPixelIds: [],
          metaPixelList: [],
          selectedMetaPixelId: null,
          metaCurrency: null,
          dv360ClientId: null,
          dv360ClientSecret: null,
          dv360RefreshToken: null,
          dv360AdvertiserId: null,
          dv360PartnerId: null,
          dv360Currency: null,
          // NOTE: totalAiCreditsUsd is intentionally NOT reset here. Each email's
          // usage lives in aiCreditsByEmail and is restored on re-login, so a
          // user's credit total is never lost by logging out.
          demoMode: false,      // exit demo on logout
        }),

      addMetaPixelId: (pixelId) =>
        set((state) => ({ metaPixelIds: [...new Set([...state.metaPixelIds, pixelId])] })),

      removeMetaPixelId: (pixelId) =>
        set((state) => ({ metaPixelIds: state.metaPixelIds.filter((id) => id !== pixelId) })),

      isMetaConnected: () => {
        const state = get();
        // Demo tokens (the legacy "demo-meta-token" placeholder OR anything that
        // matches isDemoCredential) DON'T count as a real connection — they
        // shouldn't surface the "Go to Dashboard" button or pass the route guard.
        if (!state.metaAccessToken || !state.metaBusinessId) return false;
        if (isDemoCredential(state.metaAccessToken)) return false;
        return true;
      },
      isDV360Connected: () => {
        const state = get();
        if (!state.dv360ClientId || !state.dv360ClientSecret || !state.dv360RefreshToken || !state.dv360AdvertiserId) return false;
        if (isDemoCredential(state.dv360RefreshToken)) return false;
        return true;
      },

      getDateRangeLabel: () => {
        const state = get();
        if (state.dateRange === "custom" && state.customDateRange) {
          const { startDate, endDate } = state.customDateRange;
          return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
        }
        return { "7d": "Last 7 Days", "30d": "Last 30 Days", "90d": "Last 90 Days", custom: "Custom" }[
          state.dateRange
        ] || "All Time";
      },

      addNamingConvention: (convention) =>
        set((state) => ({
          namingConventions: [...state.namingConventions, convention],
          activeConventionId: convention.id,
        })),

      updateNamingConvention: (id, updates) =>
        set((state) => ({
          namingConventions: state.namingConventions.map((c) =>
            c.id === id ? { ...c, ...updates, updatedAt: new Date() } : c
          ),
        })),

      deleteNamingConvention: (id) =>
        set((state) => {
          const filtered = state.namingConventions.filter((c) => c.id !== id);
          return {
            namingConventions: filtered,
            activeConventionId: state.activeConventionId === id ? filtered[0]?.id || null : state.activeConventionId,
          };
        }),

      setActiveConvention: (id) =>
        set({ activeConventionId: id }),

      getActiveConvention: () => {
        const state = get();
        return state.namingConventions.find((c) => c.id === state.activeConventionId) || null;
      },

      addBenchmarkSnapshot: (snapshot) =>
        set((state) => {
          // Avoid duplicates on same id (replace), cap history at 10 snapshots
          const filtered = state.benchmarkSnapshots.filter((s) => s.id !== snapshot.id);
          const next = [snapshot, ...filtered].slice(0, 10);
          return { benchmarkSnapshots: next, activeBenchmarkId: snapshot.id };
        }),

      setActiveBenchmark: (id) => set({ activeBenchmarkId: id }),

      removeBenchmarkSnapshot: (id) =>
        set((state) => {
          const filtered = state.benchmarkSnapshots.filter((s) => s.id !== id);
          return {
            benchmarkSnapshots: filtered.length > 0 ? filtered : [META_BENCHMARKS],
            activeBenchmarkId:
              state.activeBenchmarkId === id
                ? filtered[0]?.id || META_BENCHMARKS.id
                : state.activeBenchmarkId,
          };
        }),
    }),
    {
      name: "auth-store",
      // Exclude transient session state (demoMode) from localStorage so refresh
      // doesn't re-enter demo and other tabs / browsers stay clean.
      partialize: (state) => {
        const { demoMode: _demoMode, ...rest } = state as AuthState & { demoMode: boolean };
        return rest;
      },
      // Bump this version any time DEFAULT_NAMING_CONVENTIONS / META_BENCHMARKS
      // change in a way that should override persisted user state.
      version: 5,
      // v4: wipe persisted demo placeholder tokens. v5: Google Ads/GA4/GTM
      // integration removed — drop all google credential keys and google
      // benchmark fields from persisted state; initialize DV360 fields.
      migrate: (persistedState: unknown, fromVersion: number) => {
        let state = (persistedState as Partial<AuthState> & Record<string, unknown>) || {};
        if (fromVersion < 3) {
          state = {
            ...state,
            namingConventions: DEFAULT_NAMING_CONVENTIONS,
            activeConventionId: DEFAULT_NAMING_CONVENTIONS[0].id,
          };
        }
        if (fromVersion < 4) {
          if (state.metaAccessToken && isDemoCredential(state.metaAccessToken)) {
            state = { ...state, metaAccessToken: null, metaBusinessId: null, metaPixelIds: [] };
          }
        }
        if (fromVersion < 5) {
          // Remove every legacy Google Ads/GA4/GTM key.
          const googleKeys = [
            "googleAccessToken", "googleCustomerId", "gaPropertyId", "gtmContainerId",
            "googleAdsDeveloperToken", "googleAdsLoginCustomerId", "googleAccountsList",
            "selectedGoogleCustomerId", "selectedGAPropertyId", "selectedGTMContainerId",
          ];
          for (const k of googleKeys) delete state[k];
          // Strip google benchmark fields from persisted customBenchmarks.
          if (state.customBenchmarks && typeof state.customBenchmarks === "object") {
            const cb = { ...(state.customBenchmarks as unknown as Record<string, unknown>) };
            delete cb.googleEnhancedConversionsMatchRate;
            delete cb.googleEventCompleteness;
            delete cb.googleEventLatencyMs;
            delete cb.googleGAEventQuality;
            state.customBenchmarks = { ...DEFAULT_BENCHMARKS, ...cb } as CustomBenchmarks;
          }
          state = {
            ...state,
            dv360ClientId: null,
            dv360ClientSecret: null,
            dv360RefreshToken: null,
            dv360AdvertiserId: null,
            dv360PartnerId: null,
          };
        }
        return state as AuthState;
      },
      onRehydrateStorage: () => () => {
        useAuthStore.setState({ _hydrated: true } as any);
      },
    }
  )
);
