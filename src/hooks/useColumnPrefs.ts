/**
 * Per-account persistence for table column selections.
 *
 * Column choices made in any "Columns" picker are saved to localStorage keyed
 * by the connected account, so they survive reloads and new sessions for that
 * account without the user having to re-pick every time. Each table passes a
 * stable `tableKey`; the account segment is derived from the auth store.
 */

import { useState, useEffect, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useAuthStore } from "@/store/auth";

const PREFIX = "auditor:cols:v1";

/** Stable id for the currently connected account (or "demo" / "default"). */
export function useAccountKey(): string {
  return useAuthStore((s) =>
    s.demoMode
      ? "demo"
      : s.metaBusinessId ||
        s.selectedMetaPixelId ||
        s.dv360AdvertiserId ||
        "default"
  );
}

/**
 * Like useState<string[]> for a column-id list, but persisted to localStorage
 * per (account, tableKey). When `tableKey` is undefined it behaves as plain
 * in-memory state (no persistence).
 */
export function usePersistentColumns<T extends string = string>(
  tableKey: string | undefined,
  defaultIds: T[]
): [T[], Dispatch<SetStateAction<T[]>>] {
  const account = useAccountKey();
  const storageKey = tableKey ? `${PREFIX}:${account}:${tableKey}` : null;
  const [cols, setColsState] = useState<T[]>([...defaultIds]);

  // Load saved selection whenever the (account, table) key changes. Falls back
  // to defaults when nothing is stored or the stored value is malformed.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string") && parsed.length > 0) {
          setColsState(parsed as T[]);
          return;
        }
      }
      setColsState([...defaultIds]);
    } catch {
      setColsState([...defaultIds]);
    }
    // defaultIds intentionally excluded — its array identity changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const setCols = useCallback<Dispatch<SetStateAction<T[]>>>(
    (next) => {
      setColsState((prev) => {
        const value = typeof next === "function" ? (next as (p: T[]) => T[])(prev) : next;
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(value));
          } catch {
            /* storage full / unavailable — selection still works in-session */
          }
        }
        return value;
      });
    },
    [storageKey]
  );

  return [cols, setCols];
}

/**
 * Single-value counterpart to usePersistentColumns — for a single picked
 * metric id (e.g. a KPI card's metric, or a chart's primary/secondary Y axis)
 * rather than a list of column ids. Same per-account persistence semantics.
 */
export function usePersistentValue<T extends string = string>(
  tableKey: string | undefined,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] {
  const account = useAccountKey();
  const storageKey = tableKey ? `${PREFIX}:${account}:${tableKey}` : null;
  const [value, setValueState] = useState<T>(defaultValue);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "string" && parsed.length > 0) {
          setValueState(parsed as T);
          return;
        }
      }
      setValueState(defaultValue);
    } catch {
      setValueState(defaultValue);
    }
    // defaultValue intentionally excluded — only storageKey should retrigger load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValueState((prev) => {
        const val = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(val));
          } catch {
            /* storage full / unavailable — selection still works in-session */
          }
        }
        return val;
      });
    },
    [storageKey]
  );

  return [value, setValue];
}

/**
 * Object counterpart to usePersistentValue — persists a full JSON-serialisable
 * value (arrays of objects, nested config, etc.) per account. Used for things
 * like a media plan (segments with planned numbers + campaign assignments) that
 * should survive reloads/sessions and stay separate per connected account.
 */
export function usePersistentJSON<T>(
  tableKey: string | undefined,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] {
  const account = useAccountKey();
  const storageKey = tableKey ? `${PREFIX}:${account}:${tableKey}` : null;
  const [value, setValueState] = useState<T>(defaultValue);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        setValueState(JSON.parse(raw) as T);
        return;
      }
      setValueState(defaultValue);
    } catch {
      setValueState(defaultValue);
    }
    // defaultValue intentionally excluded — only storageKey should retrigger load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValueState((prev) => {
        const val = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(val));
          } catch {
            /* storage full / unavailable — selection still works in-session */
          }
        }
        return val;
      });
    },
    [storageKey]
  );

  return [value, setValue];
}
