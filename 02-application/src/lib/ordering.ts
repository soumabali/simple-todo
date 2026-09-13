/**
 * Ordering arithmetic (PRD §6.2).
 *
 * `position` is numeric. Moving an item between A and B:
 *   position = (A.position + B.position) / 2
 * When the gap drops below EPSILON, rebalance the column (1000, 2000, 3000…).
 */

export const EPSILON = 0.0001;
export const REBALANCE_STEP = 1000;

export type Positioned = { position: number };

/** True when the midpoint of A and B is too close to distinguish. */
export function needsRebalance(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

/** Midpoint used when dropping between `prev` and `next`. */
export function midpoint(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return REBALANCE_STEP;
  if (prev === null) return next! / 2;
  if (next === null) return prev! + REBALANCE_STEP;
  return (prev + next) / 2;
}

/**
 * Compute a fresh, evenly-spaced position for a column given the current
 * positions of its items, ordered ascending. Returns { position, rebalance }
 * where rebalance lists the [id, newPosition] pairs to persist.
 */
export function positionForDrop(
  positions: number[], // existing positions in the target column, ascending
  prevPosition: number | null, // position of item above the drop point
  nextPosition: number | null // position of item below the drop point
): { position: number; rebalance: { index: number; position: number }[] } {
  const pos = midpoint(prevPosition, nextPosition);

  if (prevPosition !== null && nextPosition !== null && needsRebalance(prevPosition, nextPosition)) {
    // Rebalance the whole column: rewrite positions as 1000, 2000, 3000, …
    const rebalance = positions
      .slice()
      .sort((a, b) => a - b)
      .map((p, i) => ({ index: i, position: (i + 1) * REBALANCE_STEP }));

    // The new item's position: between the (prev) and (next) after rebalance.
    let newPos = pos;
    const prevIdx = positions.findIndex((p) => p === prevPosition);
    const nextIdx = positions.findIndex((p) => p === nextPosition);
    if (prevIdx >= 0 && nextIdx >= 0) {
      newPos = (rebalance[prevIdx].position + rebalance[nextIdx].position) / 2;
    }
    return { position: newPos, rebalance };
  }

  return { position: pos, rebalance: [] };
}

/** Rebalance an entire list of ordered positions to a fresh even spacing. */
export function rebalancePositions(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i + 1) * REBALANCE_STEP);
}
