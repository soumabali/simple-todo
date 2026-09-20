"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "@/lib/api";
import type { BoardData } from "@/app/(app)/boards/[id]/page";
import { GanttView } from "./gantt-view";
import { useHiddenStatuses } from "@/lib/status-visibility";
import { TaskDetail } from "./task-detail";
import { ConfirmDialog } from "./confirm-dialog";

type Status = BoardData["statuses"][number];
type Task = BoardData["tasks"][number];

function dateChip(task: Task): { label: string; cls: string } | null {
  if (!task.dueDate) return null;
  if (task.completedAt) return { label: formatDate(task.dueDate), cls: "chip-emerald" };
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.round((+new Date(task.dueDate) - +new Date(today)) / 86400000);
  if (diff < 0) return { label: `${-diff} days late`, cls: "chip-rose" };
  if (diff === 0) return { label: "Today", cls: "chip-rose" };
  if (diff === 1) return { label: "Tomorrow", cls: "chip-amber" };
  if (diff <= 3) return { label: formatDate(task.dueDate), cls: "chip-amber" };
  return { label: formatDate(task.dueDate), cls: "chip-grey" };
}

function formatDate(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en", { day: "numeric", month: "short" });
}

export function BoardView({
  data,
  initialView = "board",
  initialTaskId = null,
}: {
  data: BoardData;
  initialView?: "board" | "gantt" | "list";
  initialTaskId?: string | null;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<"board" | "gantt" | "list">(initialView);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses the search input (matches the placeholder hint) — U6.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const moveMutation = useMutation({
    mutationFn: (v: { id: string; statusId: string; prevPosition: number | null; nextPosition: number | null }) =>
      api(`/api/tasks/${v.id}/move`, { method: "PATCH", body: JSON.stringify(v) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
  });

  // Reorder a column by swapping its position with its neighbour (U4).
  const moveColumnMutation = useMutation({
    mutationFn: async ({ id, newPosition }: { id: string; newPosition: number }) =>
      api(`/api/statuses/${id}/move`, { method: "PATCH", body: JSON.stringify({ position: newPosition }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
  });

  function moveColumn(statusId: string, dir: -1 | 1) {
    const ordered = [...data.statuses].sort((a, b) => Number(a.position) - Number(b.position));
    const i = ordered.findIndex((s) => s.id === statusId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    // Swap the two positions.
    const a = ordered[i];
    const b = ordered[j];
    moveColumnMutation.mutate({ id: a.id, newPosition: Number(b.position) });
    moveColumnMutation.mutate({ id: b.id, newPosition: Number(a.position) });
  }

  const tasksByStatus = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const s of data.statuses) map[s.id] = [];
    for (const t of data.tasks) {
      if (!map[t.statusId]) map[t.statusId] = [];
      map[t.statusId].push(t);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => Number(a.position) - Number(b.position));
    }
    return map;
  }, [data]);

  const filtered = useMemo(() => {
    if (!search.trim()) return tasksByStatus;
    const q = search.toLowerCase();
    const out: Record<string, Task[]> = {};
    for (const s of data.statuses) out[s.id] = [];
    for (const [sid, list] of Object.entries(tasksByStatus)) {
      out[sid] = list.filter((t) => t.title.toLowerCase().includes(q));
    }
    return out;
  }, [tasksByStatus, search, data.statuses]);

  // taskId → its labels, so cards can render label chips (U1).
  const labelsByTask = useMemo(() => {
    const byId = new Map(data.labels.map((l) => [l.id, l]));
    const map: Record<string, { id: string; name: string; color: string }[]> = {};
    for (const tl of data.taskLabels) {
      const label = byId.get(tl.labelId);
      if (!label) continue;
      (map[tl.taskId] ??= []).push(label);
    }
    return map;
  }, [data.labels, data.taskLabels]);

  function onDragStart(e: DragStartEvent) {
    const task = data.tasks.find((t) => t.id === e.active.id);
    setActiveTask(task ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = e;
    if (!over) return;
    const taskId = String(active.id);
    const overId = String(over.id);

    // Determine the target column and the task we dropped onto (if any).
    let statusId: string;
    let overTaskId: string | null = null;

    const targetStatus = data.statuses.find((s) => s.id === overId);
    if (targetStatus) {
      // Dropped onto the column itself (empty area) → append to the end.
      statusId = targetStatus.id;
    } else {
      // Dropped over another task → take its column and insert before it.
      const overTask = data.tasks.find((t) => t.id === overId);
      if (!overTask) return;
      statusId = overTask.statusId;
      overTaskId = overTask.id;
    }

    // Sorted tasks in the target column, excluding the dragged task.
    const sorted = data.tasks
      .filter((t) => t.statusId === statusId && t.id !== taskId)
      .sort((a, b) => Number(a.position) - Number(b.position));

    // Resolve the insertion index: before the over-task, or append at the end.
    let idx = sorted.length;
    if (overTaskId) {
      const found = sorted.findIndex((t) => t.id === overTaskId);
      if (found >= 0) idx = found;
    }

    const prevTask = idx > 0 ? sorted[idx - 1] : null;
    const nextTask = idx < sorted.length ? sorted[idx] : null;

    moveMutation.mutate({
      id: taskId,
      statusId,
      prevPosition: prevTask ? Number(prevTask.position) : null,
      nextPosition: nextTask ? Number(nextTask.position) : null,
    });
  }

  // Which columns the user has hidden (persisted viewing preference) — U-hide.
  const { hiddenStatusIds, isHidden, toggle: toggleStatus, showAll, ready: hiddenReady } = useHiddenStatuses();

  // Everything below renders this: board / list / gantt all respect hidden columns.
  const visibleData = useMemo<BoardData>(() => {
    if (!hiddenReady || hiddenStatusIds.length === 0) return data;
    const statuses = data.statuses.filter((s) => !hiddenStatusIds.includes(s.id));
    const keep = new Set(statuses.map((s) => s.id));
    return { ...data, statuses, tasks: data.tasks.filter((t) => keep.has(t.statusId)) };
  }, [data, hiddenStatusIds, hiddenReady]);

  const header = (
    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
      <h1 className="text-xl font-bold truncate">{data.board.name}</h1>
      <div className="flex items-center gap-2">
        <ColumnsMenu
          statuses={data.statuses}
          isHidden={isHidden}
          onToggle={toggleStatus}
          onShowAll={showAll}
          hiddenCount={hiddenStatusIds.length}
        />
        <ViewToggle view={view} setView={setView} />
      </div>
    </div>
  );

  if (view === "gantt") {
    return (
      <div className="p-4">
        {header}
        <GanttView data={visibleData} onOpenTask={setSelectedTaskId} />
        {selectedTaskId && (
          <TaskDetail data={data} taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
        )}
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="p-4 max-w-4xl mx-auto">
        {header}
        <ListView data={visibleData} onOpenTask={setSelectedTaskId} />
        {selectedTaskId && (
          <TaskDetail data={data} taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="p-4 h-full flex flex-col">
      {header}

      <div className="mb-3">
        <input
          ref={searchRef}
          className="input"
          placeholder="Search tasks…  (/ to focus)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1" style={{ alignItems: "flex-start" }}>
          {visibleData.statuses.map((status, i) => (
            <Column
              key={status.id}
              status={status}
              tasks={filtered[status.id] ?? []}
              boardId={data.board.id}
              searchActive={search.trim().length > 0}
              labelsByTask={labelsByTask}
              onOpenTask={setSelectedTaskId}
              canMoveLeft={i > 0}
              canMoveRight={i < data.statuses.length - 1}
              onMove={(dir) => moveColumn(status.id, dir)}
              otherStatuses={data.statuses.filter((s) => s.id !== status.id)}
            />
          ))}
          <AddColumn boardId={data.board.id} />
        </div>

        <DragOverlay>
          {activeTask ? (
            <div className="card p-3" style={{ transform: "scale(1.02)" }}>
              <TaskCardInner task={activeTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedTaskId && (
        <TaskDetail data={data} taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
      )}
    </div>
  );
}

function ViewToggle({ view, setView }: { view: string; setView: (v: any) => void }) {
  const opts = ["board", "gantt", "list"];
  return (
    <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--card-border)" }}>
      {opts.map((o) => (
        <button
          key={o}
          className="px-3 py-1.5 text-sm capitalize"
          style={view === o ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)" }}
          onClick={() => setView(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

const COLUMN_COLORS = ["slate", "indigo", "sky", "emerald", "amber", "rose", "violet"];

/**
 * "Columns" dropdown — hide/show status columns from the dashboard.
 * The view preference is per-browser and applies to board, list and gantt.
 */
function ColumnsMenu({
  statuses,
  isHidden,
  onToggle,
  onShowAll,
  hiddenCount,
}: {
  statuses: Status[];
  isHidden: (id: string) => boolean;
  onToggle: (id: string) => void;
  onShowAll: () => void;
  hiddenCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn btn-ghost text-sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose which columns appear on the dashboard"
      >
        Columns
        {hiddenCount > 0 && (
          <span
            className="px-1.5 rounded-full text-[10px]"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {hiddenCount} hidden
          </span>
        )}
        <span style={{ color: "var(--muted)", fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 rounded-lg py-1 z-50"
          role="menu"
          style={{
            minWidth: 210,
            background: "var(--card)",
            border: "1px solid var(--card-border)",
            boxShadow: "0 8px 24px rgb(0 0 0 / 0.18)",
          }}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Show on dashboard
          </div>
          {statuses.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer"
              style={{ color: "var(--foreground)" }}
            >
              <input
                type="checkbox"
                checked={!isHidden(s.id)}
                onChange={() => onToggle(s.id)}
                style={{ accentColor: "var(--accent)" }}
              />
              <span
                style={{ width: 8, height: 8, borderRadius: 999, background: `var(--${s.color})`, flexShrink: 0 }}
              />
              <span className="truncate flex-1">{s.name}</span>
              {s.isDone && (
                <span className="text-[10px]" style={{ color: "var(--muted)" }} title="Tasks here count as completed">
                  ✓
                </span>
              )}
            </label>
          ))}
          {hiddenCount > 0 && (
            <>
              <div style={{ borderTop: "1px solid var(--card-border)", margin: "4px 0" }} />
              <button
                className="w-full text-left px-3 py-1.5 text-sm"
                style={{ color: "var(--accent)" }}
                onClick={() => {
                  onShowAll();
                  setOpen(false);
                }}
              >
                Show all columns
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Column({
  status,
  tasks,
  boardId,
  searchActive,
  labelsByTask,
  onOpenTask,
  canMoveLeft,
  canMoveRight,
  onMove,
  otherStatuses,
}: {
  status: Status;
  tasks: Task[];
  boardId: string;
  searchActive: boolean;
  labelsByTask: Record<string, { id: string; name: string; color: string }[]>;
  onOpenTask: (id: string) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMove: (dir: -1 | 1) => void;
  /** Every other column on this board, as delete destinations. */
  otherStatuses: Status[];
}) {
  const { setNodeRef } = useSortable({ id: status.id });
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editName, setEditName] = useState(status.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Column that receives this column's tasks on delete (F-3.3). Without it the
  // API rejects the delete, so a column holding tasks was previously undeletable.
  const [moveTo, setMoveTo] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: ["board", boardId] });

  const createTask = useMutation({
    mutationFn: (title: string) =>
      api(`/api/boards/${boardId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title, statusId: status.id }),
      }),
    onSuccess: () => {
      invalidate();
      setNewTitle("");
    },
  });

  const renameColumn = useMutation({
    mutationFn: (name: string) =>
      api(`/api/statuses/${status.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: () => {
      invalidate();
      setRenaming(false);
    },
  });

  const recolor = useMutation({
    mutationFn: (color: string) =>
      api(`/api/statuses/${status.id}`, { method: "PATCH", body: JSON.stringify({ color }) }),
    onSuccess: () => {
      invalidate();
      setMenuOpen(false);
    },
  });

  const removeColumn = useMutation({
    mutationFn: (target?: string) =>
      api(`/api/statuses/${status.id}${target ? `?moveTo=${encodeURIComponent(target)}` : ""}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      invalidate();
      setConfirmDelete(false);
      setMoveTo("");
    },
  });

  const accent = `var(--${status.color})`;
  const empty = tasks.length === 0;

  return (
    <div ref={setNodeRef} className="flex flex-col shrink-0 w-72 rounded-lg" style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}>
      <div style={{ height: 3, background: accent, borderRadius: "8px 8px 0 0" }} />
      <div className="flex items-center justify-between px-3 py-2 gap-1">
        {renaming ? (
          <form
            className="flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (editName.trim()) renameColumn.mutate(editName.trim());
            }}
          >
            <input
              className="input text-sm"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Escape" && setRenaming(false)}
            />
          </form>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-sm truncate">{status.name}</span>
            <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>{tasks.length}</span>
            {status.isDone && (
              <span
                className="text-xs shrink-0"
                title="This is the 'done' column"
                style={{ color: "var(--success)" }}
              >
                ✓
              </span>
            )}
          </div>
        )}

        <div className="relative shrink-0">
          <button
            className="btn btn-ghost text-xs px-2 py-1"
            aria-label="Column options"
            onClick={() => setMenuOpen((o) => !o)}
          >
            ⋯
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-1 z-20 card p-1 w-44 text-sm" style={{ boxShadow: "var(--shadow-card)" }}>
                <button
                  className="w-full text-left px-3 py-1.5 rounded hover:bg-black/5 disabled:opacity-40"
                  disabled={!canMoveLeft}
                  onClick={() => { onMove(-1); setMenuOpen(false); }}
                >
                  ← Move left
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 rounded hover:bg-black/5 disabled:opacity-40"
                  disabled={!canMoveRight}
                  onClick={() => { onMove(1); setMenuOpen(false); }}
                >
                  → Move right
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 rounded hover:bg-black/5"
                  onClick={() => { setEditName(status.name); setRenaming(true); setMenuOpen(false); }}
                >
                  Rename
                </button>
                <div className="px-3 py-1.5">
                  <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>Color</div>
                  <div className="flex gap-1">
                    {COLUMN_COLORS.map((c) => (
                      <button
                        key={c}
                        aria-label={`Color ${c}`}
                        className="w-4 h-4 rounded-full"
                        style={{
                          background: `var(--${c})`,
                          outline: status.color === c ? "2px solid var(--accent)" : "none",
                          outlineOffset: 1,
                        }}
                        onClick={() => recolor.mutate(c)}
                      />
                    ))}
                  </div>
                </div>
                <button
                  className="w-full text-left px-3 py-1.5 rounded hover:bg-black/5"
                  style={{ color: "var(--danger)" }}
                  onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
                >
                  Delete column
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 px-2 pb-2 min-h-[40px]">
          {tasks.map((task) => (
            <SortableTask key={task.id} task={task} labels={labelsByTask[task.id] ?? []} onOpenTask={onOpenTask} />
          ))}
          {empty && (
            <div
              className="text-xs text-center py-4 rounded-lg"
              style={{ color: "var(--muted)", border: "1px dashed var(--card-border)" }}
            >
              {searchActive ? "No matching tasks" : "Drop tasks here"}
            </div>
          )}
        </div>
      </SortableContext>

      <div className="px-2 pb-2">
        {adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newTitle.trim()) createTask.mutate(newTitle.trim());
            }}
          >
            <input
              className="input"
              placeholder="Task title…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setAdding(false);
              }}
              autoFocus
            />
          </form>
        ) : (
          <button
            className="w-full text-left text-sm px-3 py-2 rounded-lg"
            style={{ color: "var(--muted)" }}
            onClick={() => setAdding(true)}
          >
            + Add task
          </button>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete column "${status.name}"?`}
        message={
          tasks.length > 0
            ? `This column holds ${tasks.length} task(s). Choose where they should go — they are never deleted with the column.`
            : "This cannot be undone."
        }
        confirmLabel={tasks.length > 0 ? "Move tasks & delete" : "Delete column"}
        danger
        busy={removeColumn.isPending}
        confirmDisabled={tasks.length > 0 && !moveTo}
        onCancel={() => {
          setConfirmDelete(false);
          setMoveTo("");
        }}
        onConfirm={() => removeColumn.mutate(tasks.length > 0 ? moveTo : undefined)}
      >
        {tasks.length > 0 && otherStatuses.length > 0 && (
          <div className="mb-3">
            <label className="block text-sm mb-1" htmlFor={`move-to-${status.id}`}>
              Move {tasks.length} task(s) to
            </label>
            <select
              id={`move-to-${status.id}`}
              className="input w-full"
              value={moveTo}
              onChange={(e) => setMoveTo(e.target.value)}
            >
              <option value="">Choose a column…</option>
              {otherStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {tasks.length > 0 && otherStatuses.length === 0 && (
          <div className="text-sm mb-3" style={{ color: "var(--danger)" }}>
            This is the only column on the board — there is nowhere to move its tasks. Add another
            column first.
          </div>
        )}
        {removeColumn.isError && (
          <div className="text-sm" style={{ color: "var(--danger)" }}>
            {(removeColumn.error as Error)?.message ?? "Could not delete the column."}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

function SortableTask({ task, labels, onOpenTask }: { task: Task; labels: { id: string; name: string; color: string }[]; onOpenTask: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={() => onOpenTask(task.id)} className="card card-hover p-3 cursor-grab">
      <TaskCardInner task={task} labels={labels} />
    </div>
  );
}

function TaskCardInner({ task, labels = [] }: { task: Task; labels?: { id: string; name: string; color: string }[] }) {
  const chip = dateChip(task);
  return (
    <div>
      <div className="text-sm font-medium mb-1">{task.title}</div>
      {labels.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mb-1">
          {labels.map((l) => (
            <span
              key={l.id}
              className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: `var(--${l.color})`, color: "#fff" }}
            >
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        {chip && <span className={`chip ${chip.cls}`}>{chip.label}</span>}
        {task.priority === 1 && <span className="chip chip-rose">Urgent</span>}
        {task.progress > 0 && task.progress < 100 && (
          <div className="flex-1 min-w-[40px] h-1.5 rounded-full" style={{ background: "var(--card-border)" }}>
            <div className="h-full rounded-full" style={{ width: `${task.progress}%`, background: "var(--success)" }} />
          </div>
        )}
      </div>
    </div>
  );
}

function AddColumn({ boardId }: { boardId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: (n: string) =>
      api(`/api/boards/${boardId}/statuses`, { method: "POST", body: JSON.stringify({ name: n }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", boardId] });
      setName("");
      setAdding(false);
    },
  });

  if (adding) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate(name.trim());
        }}
        className="card p-3 shrink-0 w-64"
      >
        <input className="input" placeholder="Column name…" value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
      </form>
    );
  }
  return (
    <button
      className="btn btn-ghost shrink-0"
      onClick={() => setAdding(true)}
      style={{ color: "var(--muted)" }}
    >
      + Add column
    </button>
  );
}

function ListView({ data, onOpenTask }: { data: BoardData; onOpenTask: (id: string) => void }) {
  const statusName = (id: string) => data.statuses.find((s) => s.id === id)?.name ?? "";
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
            <th className="text-left p-3">Task</th>
            <th className="text-left p-3">Status</th>
            <th className="text-left p-3">Due</th>
            <th className="text-left p-3">Priority</th>
          </tr>
        </thead>
        <tbody>
          {data.tasks
            .slice()
            .sort((a, b) => Number(a.position) - Number(b.position))
            .map((t) => (
              <tr key={t.id} className="cursor-pointer" style={{ borderBottom: "1px solid var(--card-border)" }} onClick={() => onOpenTask(t.id)}>
                <td className="p-3 font-medium">{t.title}</td>
                <td className="p-3">{statusName(t.statusId)}</td>
                <td className="p-3">{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                <td className="p-3">{t.priority === 1 ? "🔴" : t.priority === 2 ? "🟠" : t.priority === 3 ? "🔵" : "⚪"}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
