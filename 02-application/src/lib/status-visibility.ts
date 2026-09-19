"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "board.hiddenStatusIds";

/**
 * Which status columns the user has hidden from the dashboard.
 *
 * Hidden columns drop out of every view (board / list / gantt) so a board with
 * lots of finished work stays readable, while the data is still one click away.
 * Persisted per browser (localStorage) — this is a viewing preference, not
 * board data, so it never needs a write to the server.
 */
export function useHiddenStatuses() {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) setIds(parsed.filter((x): x is string => typeof x === "string"));
      }
    } catch {
      /* ignore malformed storage */
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: string[]) => {
    setIds(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage full / disabled — keep the in-memory value */
    }
  }, []);

  const isHidden = useCallback((statusId: string) => ids.includes(statusId), [ids]);

  const toggle = useCallback(
    (statusId: string) => {
      setIds((prev) => {
        const next = prev.includes(statusId) ? prev.filter((x) => x !== statusId) : [...prev, statusId];
        try {
          window.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );

  const showAll = useCallback(() => persist([]), [persist]);

  return { hiddenStatusIds: ids, isHidden, toggle, showAll, ready };
}
