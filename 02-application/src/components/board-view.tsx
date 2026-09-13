"use client";

import { useMemo, useState } from "react";
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
import { TaskDetail } from "./task-detail";

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

  if (view === "gantt") {
    return (
      <div className="p-4">
        <ViewToggle view={view} setView={setView} />
        <GanttView data={data} onOpenTask={setSelectedTaskId} />
        {selectedTaskId && (
          <TaskDetail data={data} taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
        )}
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="p-4 max-w-4xl mx-auto">
        <ViewToggle view={view} setView={setView} />
        <ListView data={data} onOpenTask={setSelectedTaskId} />
        {selectedTaskId && (
          <TaskDetail data={data} taskId={selectedTaskId} onClose={() => setSelectedTaskId(null)} />
        )}
      </div>
    );
  }

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">{data.board.name}</h1>
        <ViewToggle view={view} setView={setView} />
      </div>

      <div className="mb-3">
        <input
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
          {data.statuses.map((status) => (
            <Column
              key={status.id}
              status={status}
              tasks={filtered[status.id] ?? []}
              boardId={data.board.id}
              onOpenTask={setSelectedTaskId}
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

function Column({ status, tasks, boardId, onOpenTask }: { status: Status; tasks: Task[]; boardId: string; onOpenTask: (id: string) => void }) {
  const { setNodeRef } = useSortable({ id: status.id });
  const qc = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);

  const createTask = useMutation({
    mutationFn: (title: string) =>
      api(`/api/boards/${boardId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ title, statusId: status.id }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", boardId] });
      setNewTitle("");
    },
  });

  const accent = status.color === "emerald" ? "var(--success)" : status.color === "amber" ? "var(--warning)" : status.color === "rose" ? "var(--danger)" : "var(--accent)";

  return (
    <div ref={setNodeRef} className="flex flex-col shrink-0 w-72 rounded-lg" style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}>
      <div style={{ height: 3, background: accent, borderRadius: "8px 8px 0 0" }} />
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{status.name}</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>{tasks.length}</span>
        </div>
      </div>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-2 px-2 pb-2 min-h-[40px]">
          {tasks.map((task) => (
            <SortableTask key={task.id} task={task} onOpenTask={onOpenTask} />
          ))}
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
    </div>
  );
}

function SortableTask({ task, onOpenTask }: { task: Task; onOpenTask: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onClick={() => onOpenTask(task.id)} className="card card-hover p-3 cursor-grab">
      <TaskCardInner task={task} />
    </div>
  );
}

function TaskCardInner({ task }: { task: Task }) {
  const chip = dateChip(task);
  return (
    <div>
      <div className="text-sm font-medium mb-1">{task.title}</div>
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
