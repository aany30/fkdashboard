/**
 * Campaign name validation against naming conventions.
 *
 * Detection is CONTENT-AWARE, not just positional. A rigid
 * `name.split(convention.separator)` fails whenever the campaign uses a
 * different separator than the convention (e.g. the convention wants " >> "
 * but the campaign uses "_"), collapsing the whole name into one part and
 * falsely reporting almost everything as missing. Instead we:
 *   1. Auto-detect the separator actually used in the name (falling back to the
 *      convention's) and split positionally with it.
 *   2. Independently scan the WHOLE name for each component's real value —
 *      matching the rule's `examples`, date-like tokens, etc. — so a component
 *      counts as present if it's genuinely in the name, wherever it sits.
 * A component is "present" if EITHER signal finds it.
 */

import type { NamingConvention, NamingComplianceResult, NamingComponent, NamingRule } from "@/types";

// Pass/fail threshold: if more than this share of components are missing
// from the campaign name, it fails the nomenclature check.
export const MISSING_FAIL_THRESHOLD = 65; // percent

// Distinctive delimiters — safe to trust with as few as 2 parts because they
// don't occur inside ordinary tokens. Includes spaced hyphen/en-dash/em-dash.
const STRONG_SEPARATORS = [" >> ", " | ", " - ", " – ", " — ", " · ", " • ", " / ", " :: ", ">>", "::", "|", "·", "•", "_"];
// Bare dashes / slash appear INSIDE tokens too ("Summer-Sale", "Q2-2026",
// "21/05"), so we only treat them as a delimiter when they repeat enough to
// clearly structure the name (≥3 parts = used ≥2 times as a separator).
const WEAK_SEPARATORS = ["-", "–", "—", "/"];

/** Pick the separator that actually structures this name (most non-empty parts). */
function detectSeparator(name: string, conventionSep: string): string {
  let best = conventionSep;
  let bestParts = name.split(conventionSep).filter((p) => p.trim().length > 0).length;
  for (const sep of [conventionSep, ...STRONG_SEPARATORS]) {
    if (!sep) continue;
    const parts = name.split(sep).filter((p) => p.trim().length > 0).length;
    if (parts >= 2 && parts > bestParts) { bestParts = parts; best = sep; }
  }
  // Only consider a bare dash/slash when no distinctive delimiter structured the
  // name, and only if it yields ≥3 parts (a real repeated delimiter, not an
  // in-token hyphen like "Summer-Sale" or a date like "Q2-2026").
  if (bestParts < 2) {
    for (const sep of WEAK_SEPARATORS) {
      const parts = name.split(sep).filter((p) => p.trim().length > 0).length;
      if (parts >= 3 && parts > bestParts) { bestParts = parts; best = sep; }
    }
  }
  return best;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does `name` contain `needle` as a whole word / token (case-insensitive)? */
function containsToken(nameLower: string, needle: string): boolean {
  const n = needle.toLowerCase().trim();
  if (!n) return false;
  // Plain substring is enough for multi-word phrases ("awareness . reach");
  // for short single tokens, require a word-ish boundary to avoid "x" in "box".
  if (n.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(n)}([^a-z0-9]|$)`, "i").test(nameLower);
  }
  return nameLower.includes(n);
}

const DATE_RE = new RegExp(
  [
    "\\b20\\d{2}\\b",                                   // year 20xx
    "\\b(q[1-4])\\b",                                   // quarters
    "\\b(w\\d{1,2})\\b",                                 // week tokens W1..W52
    "\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\b", // months
    "\\b\\d{1,2}[-/.]\\d{1,2}([-/.]\\d{2,4})?\\b",      // 12/05, 12-05-2026
  ].join("|"),
  "i"
);

/** Heuristic: is this rule about a date / time period? */
function isDateRule(rule: NamingRule): boolean {
  const hay = `${rule.id} ${rule.label} ${rule.placeholder} ${rule.description}`.toLowerCase();
  if (/(date|month|quarter|week|year|timing|period|flight|schedule)/.test(hay)) return true;
  // Also date-capable when the rule's own examples embed date tokens — e.g. a
  // "Campaign Name" rule with examples like "Q2-Campaign" / "Launch-2026"
  // routinely carries the date, so a name ending in "June'26" should match it.
  if (rule.examples?.some((ex) => DATE_RE.test(ex))) return true;
  return false;
}

/**
 * Try to find a rule's value anywhere in the name (content detection).
 * Returns the matched text, or null when nothing convincing is found.
 */
function detectByContent(rule: NamingRule, name: string, nameLower: string): string | null {
  // 1. Match against the rule's known examples / dropdown options.
  // For select-type rules the examples are a true enum, so sub-word matching is
  // safe & useful ("Awareness . Reach" → "awareness"/"reach"). For free-text
  // rules the examples are only illustrative (e.g. "Q2-Campaign"), so we require
  // a full-phrase match — otherwise the generic word "campaign" would match any
  // name containing "campaign".
  if (rule.examples?.length) {
    const enumLike = rule.inputType === "select";
    for (const ex of rule.examples) {
      if (containsToken(nameLower, ex)) return ex;
      if (enumLike) {
        const words = ex.toLowerCase().split(/[\s._·•>|/\\-]+/).filter((w) => w.length >= 3);
        for (const w of words) {
          if (containsToken(nameLower, w)) return ex;
        }
      }
    }
  }
  // 2. Date-type rules: any date-like token in the name.
  if (isDateRule(rule)) {
    const m = name.match(DATE_RE);
    if (m) return m[0];
  }
  return null;
}

export function validateCampaignName(
  campaignName: string,
  convention: NamingConvention
): NamingComplianceResult {
  const components: NamingComponent[] = [];
  const name = campaignName ?? "";
  const nameLower = name.toLowerCase();

  // Positional split by the separator the name actually uses.
  const sep = detectSeparator(name, convention.separator);
  const parts = name.split(sep).map((p) => p.trim());
  const separatorStructured = parts.filter((p) => p.length > 0).length >= 2;
  // Track which positional parts a content match has already consumed, so two
  // rules can't both claim the same token purely positionally.
  const usedParts = new Set<number>();

  let totalCount = 0;
  let presentCount = 0;

  for (const rule of convention.rules) {
    // Signal A — content detection (matches examples / dates anywhere in name).
    const contentValue = detectByContent(rule, name, nameLower);

    // Signal B — positional: the part at this rule's index, but only trusted
    // when the name is actually separator-structured (otherwise part[0] holds
    // the whole name and would falsely satisfy position 1).
    let positionalValue: string | null = null;
    if (separatorStructured) {
      const idx = rule.position - 1;
      const v = parts[idx];
      if (v && v.length > 0 && !usedParts.has(idx)) {
        positionalValue = v;
      }
    }

    const actualValue = contentValue ?? positionalValue;
    const isPresent = actualValue !== null && actualValue.trim().length > 0;

    // Mark the positional slot consumed when that's what satisfied the rule.
    if (isPresent && !contentValue && separatorStructured) {
      usedParts.add(rule.position - 1);
    }

    // Required field is "valid" only if present; optional fields are always valid.
    const isValid = !rule.required || isPresent;

    // Count EVERY rule for the missing-% calculation (see note in history):
    // completeness is measured against the full rule set.
    totalCount++;
    if (isPresent) presentCount++;

    components.push({
      position: rule.position,
      label: rule.label,
      expectedPattern: rule.placeholder,
      actualValue: actualValue?.trim() || null,
      isPresent,
      isValid,
    });
  }

  const missingPct = totalCount === 0
    ? 0
    : Math.round(((totalCount - presentCount) / totalCount) * 100);

  const status: "compliant" | "non-compliant" =
    missingPct > MISSING_FAIL_THRESHOLD ? "non-compliant" : "compliant";

  return {
    campaignId: "", // Set by caller
    campaignName,
    platform: "meta", // Set by caller
    status,
    missingPct,
    components,
  };
}

/**
 * Check if a campaign name matches a convention with fuzzy tolerance
 */
export function isCompliant(result: NamingComplianceResult, allowMissing: number = 0): boolean {
  const missingCount = result.components.filter((c) => !c.isValid).length;
  return missingCount <= allowMissing;
}

/**
 * Get human-readable description of what's wrong
 */
export function getComplianceDetails(result: NamingComplianceResult): string[] {
  const issues: string[] = [];

  for (const component of result.components) {
    if (!component.isValid) {
      if (!component.isPresent) {
        issues.push(`Missing: ${component.label}`);
      } else {
        issues.push(`Invalid: ${component.label} should match "${component.expectedPattern}"`);
      }
    }
  }

  return issues;
}
