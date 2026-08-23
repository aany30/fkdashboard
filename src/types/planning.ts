export interface Planned {
  spend: number;
  reach: number;
  impressions: number;
  frequency?: number;
  cpm?: number;
  vtr?: number;
  ctr?: number;
  views?: number;
  clicks?: number;
}

export interface PlanItem {
  entityType: "campaign" | "adset" | "ad";
  entityId: string;
  entityName: string;
  campaignId: string;
  parentId?: string;
  plan: Planned;
}

export interface PlanGroup {
  id: string;
  name: string;
  items: PlanItem[];
  createdAt: number;
  updatedAt: number;
}

export interface SavedPlanStoreV2 {
  version: 2;
  groups: PlanGroup[];
}

export interface DrillPathEntry {
  type: "campaign" | "adset" | "ad" | "io" | "li";
  id: string;
  name: string;
}
