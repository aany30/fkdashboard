import type { ReactNode } from "react";
import { TermText } from "@/components/shared/Term";
import FixRecommendation from "@/components/shared/FixRecommendation";
import type { CampaignData } from "@/types";
import type { AccountContext } from "./types";

export interface FixContext {
  /** Stable metric ID (e.g. "budget_overspending", "emq_low"). */
  metric: string;
  platform?: "meta" | "google" | "both";
  threshold?: string;
  /** Per-campaign data when the failure is per-campaign. */
  campaignContext?: CampaignData;
  /** Account-level snapshot (from buildAccountContext()). */
  accountContext?: AccountContext;
  /** Required: audit module + sibling metrics so the AI sees the full picture. */
  auditContext: {
    module: string;
    siblingMetrics?: Record<string, string | number>;
  };
}

interface KpiCardProps {
  label: string;
  value: string | number;
  subLabel?: string;
  tone?: "default" | "good" | "warn" | "bad";
  /** Opt-in: when set AND tone is bad/warn, render a "How to fix this" expander. */
  fixContext?: FixContext;
}

const toneClasses: Record<NonNullable<KpiCardProps["tone"]>, string> = {
  default: "text-gray-900",
  good: "text-green-600",
  warn: "text-yellow-600",
  bad: "text-red-600",
};

export function KpiCard({ label, value, subLabel, tone = "default", fixContext }: KpiCardProps) {
  const showFix = fixContext && (tone === "bad" || tone === "warn");
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm overflow-visible">
      <div className="text-sm text-gray-600"><TermText>{label}</TermText></div>
      <div className={`text-3xl font-bold mt-1 ${toneClasses[tone]}`}>{value}</div>
      {subLabel && <div className="text-xs text-gray-500 mt-1"><TermText>{subLabel}</TermText></div>}
      {showFix && (
        <FixRecommendation
          metric={fixContext!.metric}
          value={value}
          status={tone === "bad" ? "bad" : "warn"}
          platform={fixContext!.platform}
          threshold={fixContext!.threshold}
          campaignContext={fixContext!.campaignContext}
          accountContext={fixContext!.accountContext}
          auditContext={fixContext!.auditContext}
        />
      )}
    </div>
  );
}

interface AuditCardProps {
  title: string;
  description?: string;
  badge?: { text: string; color: "green" | "yellow" | "red" | "blue" | "gray" };
  children: ReactNode;
}

const badgeColors = {
  green: "bg-green-100 text-green-700",
  yellow: "bg-yellow-100 text-yellow-700",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700",
  gray: "bg-gray-100 text-gray-700",
};

export function AuditCard({ title, description, badge, children }: AuditCardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900"><TermText>{title}</TermText></h3>
          {description && <p className="text-sm text-gray-600 mt-0.5"><TermText>{description}</TermText></p>}
        </div>
        {badge && (
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badgeColors[badge.color]}`}>
            {badge.text}
          </span>
        )}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

interface AuditTableProps {
  columns: string[];
  rows: Array<Array<ReactNode>>;
  emptyMessage?: string;
}

export function AuditTable({ columns, rows, emptyMessage = "No data available" }: AuditTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
          <tr>
            {columns.map((col, i) => (
              <th key={i} className="px-4 py-2 text-left font-semibold text-gray-700">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-6 text-center text-gray-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-2.5 text-gray-900">
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function StatusBadge({ status, label }: { status: "pass" | "fail" | "warn" | "info"; label: string }) {
  const colors = {
    pass: "bg-green-100 text-green-700",
    fail: "bg-red-100 text-red-700",
    warn: "bg-yellow-100 text-yellow-700",
    info: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[status]}`}>
      {label}
    </span>
  );
}
