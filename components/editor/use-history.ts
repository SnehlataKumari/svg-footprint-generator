"use client";

import { useCallback, useState } from "react";

const LIMIT = 200;

/**
 * Undo/redo over an immutable value.
 * - `set(next)`      records a new undo step.
 * - `replace(next)`  changes the value WITHOUT a new step — for continuous
 *                    edits (dragging a vertex). Call `checkpoint()` once when
 *                    the drag starts so the whole drag undoes as one step.
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState({ past: [] as T[], present: initial, future: [] as T[] });

  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setState((s) => {
        const value = typeof next === "function" ? (next as (p: T) => T)(s.present) : next;
        if (value === s.present) return s;
        return { past: [...s.past, s.present].slice(-LIMIT), present: value, future: [] };
      }),
    [],
  );

  const replace = useCallback(
    (next: T | ((prev: T) => T)) =>
      setState((s) => ({
        ...s,
        present: typeof next === "function" ? (next as (p: T) => T)(s.present) : next,
      })),
    [],
  );

  const checkpoint = useCallback(
    () => setState((s) => ({ past: [...s.past, s.present].slice(-LIMIT), present: s.present, future: [] })),
    [],
  );

  const undo = useCallback(
    () =>
      setState((s) =>
        s.past.length
          ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] }
          : s,
      ),
    [],
  );

  const redo = useCallback(
    () =>
      setState((s) =>
        s.future.length
          ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) }
          : s,
      ),
    [],
  );

  return {
    value: state.present,
    set,
    replace,
    checkpoint,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
