import { describe, it, expect } from "vitest";
import { eq, and, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Regression guard for the `a && b` bug in a Drizzle `where` callback.
 *
 * WHAT WENT WRONG
 * ---------------
 * `POST /api/boards/[id]/labels` checked for a duplicate name like this:
 *
 *     where: (l, { eq: e }) => e(l.boardId, id) && e(l.name, name)
 *
 * `eq()` returns an object, so the left operand of `&&` is ALWAYS truthy and JS
 * short-circuits to the right operand alone. Only ONE condition reached the
 * query, so the duplicate check ignored `board_id` entirely and a label name
 * became unique across all boards — even though the DB index is
 * `uq_labels_board_name (board_id, name)`.
 *
 * Nothing about that line looks wrong on inspection, so this file asserts on the
 * generated query shape (how many conditions, which columns appear) rather than
 * on the source text. It can only pass if BOTH columns actually reach the query.
 */

/**
 * Column stand-ins. Drizzle embeds the column object itself as the bound
 * parameter, so these are plain `{table, name}` records — enough for the
 * dialect to render and for us to identify which columns were included.
 */
const col = (table: string, name: string) => ({ table, name }) as never;

const dialect = new PgDialect();

/** Describe which columns survive into the generated SQL. */
function shape(condition: SQL | undefined) {
  const q = dialect.sqlToQuery(condition as SQL);
  const cols = q.params
    .map((p) => (p as { name?: string } | null)?.name)
    .filter((n): n is string => typeof n === "string");
  return {
    sql: q.sql,
    conditions: (q.sql.match(/=/g) ?? []).length,
    columns: cols,
  };
}

const labels = { boardId: col("labels", "board_id"), name: col("labels", "name") };
const correct = and(eq(labels.boardId, "board-x"), eq(labels.name, "urgent"));

describe("drizzle where: `&&` silently drops a condition", () => {
  it("the buggy form keeps only ONE condition (board_id is lost)", () => {
    // Exactly what the route used to do.
    const buggy = (eq(labels.boardId, "board-x") as unknown) &&
      (eq(labels.name, "urgent") as unknown);
    const got = shape(buggy as SQL);
    expect(got.conditions).toBe(1);
    expect(got.columns).toEqual(["name"]);
    expect(got.columns).not.toContain("board_id");
  });

  it("the fixed form keeps BOTH conditions", () => {
    const got = shape(correct);
    expect(got.conditions).toBe(2);
    expect(got.columns).toEqual(["board_id", "name"]);
  });

  it("and() and && are not interchangeable", () => {
    const viaAmp = (eq(labels.boardId, "board-x") as unknown) &&
      (eq(labels.name, "urgent") as unknown);
    expect(shape(viaAmp as SQL).columns).not.toEqual(shape(correct).columns);
  });
});
