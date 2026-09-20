import { NextResponse } from "next/server";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { tasks, taskLabels, labels } from "@/db/schema";
import {
  withApi,
  preflight,
  serializeTask,
  todayIn,
  parseLimit,
  assertDate,
  type PublicTask,
} from "@/lib/api-v1";
import { ApiError } from "@/lib/session";
import { createTask } from "@/lib/domain";

/**
 * GET /api/v1/todos — list the key owner's tasks.
 *
 * Query params (all optional):
 *   boardId=<uuid>          restrict to one board
 *   statusId=<uuid>         restrict to one column
 *   state=open|done|all     completion filter (default: open)
 *   due=overdue|today|soon|none|any
 *                           overdue → past due & not done
 *                           today   → due today
 *                           soon    → due within `within` days (default 7)
 *                           none    → tasks without a due date
 *   within=<days>           window for due=soon (default 7, max 365)
 *   q=<text>                case-insensitive substring on title/description
 *   limit=<n>               default 100, max 500
 */
export const GET = withApi(async ({ db, principal }, req) => {
  const url = new URL(req.url);
  const p = url.searchParams;

  const user = await db.query.user.findFirst({
    where: (u, { eq: e }) => e(u.id, principal.userId),
    columns: { timezone: true },
  });
  const timezone = user?.timezone ?? "Asia/Makassar";
  const today = todayIn(timezone);

  const state = p.get("state") ?? "open";
  const due = p.get("due");
  const within = Math.min(Math.max(Number(p.get("within") ?? 7) || 7, 1), 365);
  const q = p.get("q")?.trim();
  const boardId = p.get("boardId");
  const statusId = p.get("statusId");
  const limit = parseLimit(p.get("limit"));

  const filters = [];

  // Ownership: tasks belong to the user through their board. Fetching the
  // board ids first keeps the query portable and readable.
  const ownedBoards = await db.query.boards.findMany({
    where: (b, { eq: e }) => e(b.userId, principal.userId),
    columns: { id: true },
  });
  const ownedBoardIds = ownedBoards.map((b) => b.id);
  if (!ownedBoardIds.length) {
    return NextResponse.json({
      todos: [],
      meta: { count: 0, limit, today, timezone, state, due: due ?? null },
    });
  }
  filters.push(inArray(tasks.boardId, ownedBoardIds));

  if (boardId) filters.push(eq(tasks.boardId, boardId));
  if (statusId) filters.push(eq(tasks.statusId, statusId));

  if (state === "open") filters.push(isNull(tasks.completedAt));
  else if (state === "done") filters.push(sql`${tasks.completedAt} IS NOT NULL`);

  if (due === "overdue") {
    filters.push(isNull(tasks.completedAt));
    filters.push(sql`${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} < ${today}`);
  } else if (due === "today") {
    filters.push(eq(tasks.dueDate, today));
  } else if (due === "soon") {
    const until = addDays(today, within);
    filters.push(isNull(tasks.completedAt));
    filters.push(
      sql`${tasks.dueDate} IS NOT NULL AND ${tasks.dueDate} >= ${today} AND ${tasks.dueDate} <= ${until}`
    );
  } else if (due === "none") {
    filters.push(isNull(tasks.dueDate));
  }

  if (q) {
    const needle = `%${q.toLowerCase()}%`;
    filters.push(
      or(
        sql`lower(${tasks.title}) LIKE ${needle}`,
        sql`lower(coalesce(${tasks.description}, '')) LIKE ${needle}`
      )!
    );
  }

  const rows = await db
    .select({ task: tasks, isDone: sql<boolean>`${tasks.completedAt} IS NOT NULL` })
    .from(tasks)
    .where(and(...filters))
    .orderBy(
      sql`${tasks.completedAt} IS NOT NULL`,
      sql`${tasks.dueDate} ASC NULLS LAST`,
      sql`${tasks.position} ASC`
    )
    .limit(limit);

  const taskList = rows.map((r) => r.task);
  const labelMap = await labelsFor(db, taskList.map((t) => t.id));

  const todos: PublicTask[] = taskList.map((t) => serializeTask(t, today, labelMap.get(t.id) ?? []));

  return NextResponse.json({
    todos,
    meta: { count: todos.length, limit, today, timezone, state, due: due ?? null },
  });
});

/**
 * POST /api/v1/todos — create a task.
 * Body: { boardId, title, statusId?, description?, priority?, startDate?,
 *         dueDate?, dueTime?, labels? }
 * When `statusId` is omitted the board's first column is used.
 */
export const POST = withApi(async ({ db, principal }, req) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const boardId = typeof body.boardId === "string" ? body.boardId : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!boardId) throw new ApiError("BAD_REQUEST", "boardId is required");
  if (!title) throw new ApiError("BAD_REQUEST", "title is required");

  let statusId = typeof body.statusId === "string" ? body.statusId : "";
  if (!statusId) {
    const first = await db.query.statuses.findFirst({
      where: (s, { eq: e }) => e(s.boardId, boardId),
      orderBy: (s, { asc }) => asc(s.position),
    });
    if (!first) throw new ApiError("BAD_REQUEST", "Board has no columns");
    statusId = first.id;
  }

  const priority = body.priority === undefined ? 2 : Number(body.priority);
  if (!Number.isInteger(priority) || priority < 1 || priority > 4) {
    throw new ApiError("BAD_REQUEST", "priority must be 1–4");
  }

  const task = await createTask(db, principal.userId, {
    boardId,
    statusId,
    title,
    description: typeof body.description === "string" ? body.description : undefined,
    priority,
    startDate: assertDate(body.startDate, "startDate"),
    dueDate: assertDate(body.dueDate, "dueDate"),
    dueTime: typeof body.dueTime === "string" && body.dueTime ? body.dueTime : null,
    remindOnStart: body.remindOnStart === undefined ? undefined : Boolean(body.remindOnStart),
    remindersMuted: body.remindersMuted === undefined ? undefined : Boolean(body.remindersMuted),
    labelIds: Array.isArray(body.labels) ? (body.labels as string[]) : undefined,
  });

  const user = await db.query.user.findFirst({
    where: (u, { eq: e }) => e(u.id, principal.userId),
    columns: { timezone: true },
  });
  const today = todayIn(user?.timezone ?? "Asia/Makassar");

  return NextResponse.json({ todo: serializeTask(task, today) }, { status: 201 });
}, "write");

export const OPTIONS = () => preflight();

/* ------------------------------- helpers ------------------------------- */

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function labelsFor(db: any, taskIds: string[]) {
  const map = new Map<string, { id: string; name: string; color: string }[]>();
  if (!taskIds.length) return map;

  const rows = await db
    .select({
      taskId: taskLabels.taskId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
    })
    .from(taskLabels)
    .innerJoin(labels, eq(labels.id, taskLabels.labelId))
    .where(inArray(taskLabels.taskId, taskIds));

  for (const r of rows) {
    const list = map.get(r.taskId) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    map.set(r.taskId, list);
  }
  return map;
}
