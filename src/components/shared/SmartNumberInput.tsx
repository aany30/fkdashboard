import { useState, useRef, useCallback, useEffect } from "react";

type Unit = "B" | "M" | "K" | "";

function pickUnit(delivered: number): Unit {
  const abs = Math.abs(delivered);
  if (abs >= 1e9) return "B";
  if (abs >= 1e6) return "M";
  if (abs >= 1e3) return "K";
  return "";
}

function unitMultiplier(u: Unit): number {
  switch (u) {
    case "B": return 1e9;
    case "M": return 1e6;
    case "K": return 1e3;
    default: return 1;
  }
}

function toDisplayVal(raw: number, unit: Unit): string {
  if (!raw) return "";
  const m = unitMultiplier(unit);
  const v = raw / m;
  if (m === 1) return String(Math.round(raw));
  return v.toFixed(2).replace(/\.?0+$/, "");
}

function indianFormat(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

interface Props {
  value: number;
  onChange: (raw: number) => void;
  deliveredHint?: number;
  kind?: "money" | "int" | "decimal" | "pct";
  currencySymbol?: string;
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  min?: number;
  step?: number;
}

export default function SmartNumberInput({
  value,
  onChange,
  deliveredHint = 0,
  kind = "int",
  currencySymbol,
  placeholder = "0",
  className = "",
  wrapperClassName,
  min = 0,
}: Props) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isScaled = kind === "int";
  const unit = isScaled ? pickUnit(deliveredHint) : "";
  const multiplier = unitMultiplier(unit);

  const [editStr, setEditStr] = useState("");

  useEffect(() => {
    if (!focused) {
      setEditStr(isScaled ? toDisplayVal(value, unit) : value ? String(value) : "");
    }
  }, [value, unit, focused, isScaled]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    setEditStr(isScaled ? toDisplayVal(value, unit) : value ? String(value) : "");
  }, [value, unit, isScaled]);

  const handleBlur = useCallback(() => {
    setFocused(false);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const str = e.target.value.replace(/[^0-9.\-]/g, "");
      setEditStr(str);
      const num = parseFloat(str) || 0;
      const raw = isScaled ? Math.round(num * multiplier) : num;
      onChange(Math.max(min, raw));
    },
    [multiplier, onChange, min, isScaled]
  );

  const blurDisplay = (() => {
    if (!value) return "";
    if (kind === "pct") return String(value);
    if (kind === "decimal") return String(value);
    if (isScaled && unit) {
      const m = unitMultiplier(unit);
      const v = value / m;
      const formatted = v % 1 === 0 ? indianFormat(v) : v.toFixed(2).replace(/\.?0+$/, "");
      return formatted;
    }
    return indianFormat(value);
  })();

  const showPrefix = kind === "money" && currencySymbol;
  const showSuffix = kind === "pct" ? "%" : (unit || "");

  return (
    <div className={wrapperClassName ?? "inline-flex items-center justify-end gap-1"}>
      {showPrefix && (
        <span className="w-3 shrink-0 text-right text-[11px] text-gray-400">{currencySymbol}</span>
      )}
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={focused ? editStr : blurDisplay}
        placeholder={placeholder}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        className={className}
      />
      {showSuffix && (
        <span className="w-5 shrink-0 text-left text-[11px] text-gray-400">{showSuffix}</span>
      )}
    </div>
  );
}
