"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { BoardData } from "@/app/(app)/boards/[id]/page";

type Task = BoardData["tasks"][number];
type Scale = "day" | "week" | "month";

const DAY = 86400000;

function toDate(s: string | null): Date | null {
  return s ? new Date(s + "T00:00:00") : null;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type DragState = {
  taskId: string;
  mode: "move" | "resize-start" | "resize-end";
  startX: number;
  origStart: string | null;
  origDue: string | null;
};

export function GanttView({ data, onOpenTask }: { data: BoardData; onOpenTask: (id: string) => void }) {
  const qc = useQueryClient();
  const [scale, setScale] = useState<Scale>("week");
  const dragState = useRef<DragState | null>(null);
  const [preview, setPreview] = useState<Record<string, { startDate: string | null; dueDate: string | null }>>({});

  // Default render window: 3 months around today.
  const today = useMemo(() => new Date(new Date().toISOString().slice(0, 10)), []);
  const start = useMemo(() => addDays(today, -30), [today]);
  const end = useMemo(() => addDays(today, 90), [today]);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) out.push(new Date(d));
    return out;
  }, [start, end]);

  const dayWidth = scale === "day" ? 48 : scale === "week" ? 24 : 12;

  const scheduled = data.tasks.filter((t) => t.startDate || t.dueDate);
  const unscheduled = data.tasks.filter((t) => !t.startDate && !t.dueDate);

  const scheduleMutation = useMutation({
    mutationFn: (v: { id: string; startDate: string | null; dueDate: string | null }) =>
      api(`/api/tasks/${v.id}/schedule`, { method: "PATCH", body: JSON.stringify(v) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
  });

  // x coordinate for a date
  function x(d: Date): number {
    return ((d.getTime() - start.getTime()) / DAY) * dayWidth;
  }

  function datesFor(task: Task): { startDate: string | null; dueDate: string | null } {
    const p = preview[task.id];
    if (p) return p;
    return { startDate: task.startDate, dueDate: task.dueDate };
  }

  function rowFor(task: Task) {
    const { startDate, dueDate } = datesFor(task);
    const s = toDate(startDate);
    const d = toDate(dueDate);
    // Only a due date → diamond marker.
    if (!s && d) {
      const dx = x(d);
      return { left: dx, width: 0, diamond: true, d };
    }
    if (s && d) {
      const left = x(s);
      const width = Math.max(dayWidth, ((d.getTime() - s.getTime()) / DAY) * dayWidth + dayWidth);
      return { left, width, diamond: false, d: null };
    }
    if (s && !d) {
      const left = x(s);
      return { left, width: dayWidth, diamond: false, d: null };
    }
    return null;
  }

  function onPointerDown(task: Task, mode: DragState["mode"], e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const { startDate, dueDate } = datesFor(task);
    dragState.current = {
      taskId: task.id,
      mode,
      startX: e.clientX,
      origStart: startDate,
      origDue: dueDate,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const ds = dragState.current;
    if (!ds) return;
    const deltaDays = Math.round((e.clientX - ds.startX) / dayWidth);
    if (deltaDays === 0) {
      setPreview((p) => ({ ...p, [ds.taskId]: { startDate: ds.origStart, dueDate: ds.origDue } }));
      return;
    }

    let startDate = ds.origStart;
    let dueDate = ds.origDue;

    if (ds.mode === "move") {
      if (ds.origStart) startDate = fmt(addDays(toDate(ds.origStart)!, deltaDays));
      if (ds.origDue) dueDate = fmt(addDays(toDate(ds.origDue)!, deltaDays));
    } else if (ds.mode === "resize-start") {
      if (ds.origStart) {
        const newStart = fmt(addDays(toDate(ds.origStart)!, deltaDays));
        // Never let start move past due.
        if (!dueDate || newStart <= dueDate) startDate = newStart;
      }
    } else if (ds.mode === "resize-end") {
      if (ds.origDue) {
        const newDue = fmt(addDays(toDate(ds.origDue)!, deltaDays));
        // Never let due move before start.
        if (!startDate || newDue >= startDate) dueDate = newDue;
      }
    }

    setPreview((p) => ({ ...p, [ds.taskId]: { startDate, dueDate } }));
  }

  function onPointerUp(_e: React.PointerEvent) {
    const ds = dragState.current;
    if (!ds) return;
    dragState.current = null;
    const p = preview[ds.taskId];
    if (!p) return;
    // Commit (optimistic; server validates start ≤ due and reschedules reminders).
    scheduleMutation.mutate({ id: ds.taskId, startDate: p.startDate, dueDate: p.dueDate });
    setPreview((prev) => {
      const next = { ...prev };
      delete next[ds.taskId];
      return next;
    });
  }

  const statusName = (id: string) => data.statuses.find((s) => s.id === id)?.name ?? "";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--card-border)" }}>
          {(["day", "week", "month"] as Scale[]).map((s) => (
            <button
              key={s}
              className="px-3 py-1 text-sm capitalize"
              style={scale === s ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)" }}
              onClick={() => setScale(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          Drag bars to move · resize from edges
        </span>
      </div>

      <div className="card overflow-x-auto">
        <div style={{ minWidth: days.length * dayWidth + 200 }}>
          {/* Header row */}
          <div className="flex sticky top-0" style={{ background: "var(--card)", borderBottom: "1px solid var(--card-border)" }}>
            <div className="shrink-0 w-[200px] p-2 text-xs font-medium" style={{ position: "sticky", left: 0, background: "var(--card)", zIndex: 2 }}>
              Task
            </div>
            <div className="flex">
              {days.map((d, i) => {
                const isToday = fmt(d) === fmt(today);
                const showLabel =
                  scale === "month" ? d.getDate() === 1 : scale === "week" ? d.getDay() === 1 : true;
                return (
                  <div
                    key={i}
                    className="p-1 text-center text-[10px] shrink-0"
                    style={{
                      width: dayWidth,
                      color: isToday ? "#fff" : "var(--muted)",
                      background: isToday ? "var(--accent)" : d.getDay() === 0 || d.getDay() === 6 ? "var(--card)" : "transparent",
                      borderRight: "1px solid var(--card-border)",
                    }}
                  >
                    {showLabel && d.toLocaleDateString("en", scale === "month" ? { month: "short" } : { day: "numeric" })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Rows */}
          {scheduled.map((task) => {
            const r = rowFor(task);
            const { dueDate } = datesFor(task);
            const pastDue = dueDate && !task.completedAt && dueDate < fmt(today);
            return (
              <div key={task.id} className="flex" style={{ borderBottom: "1px solid var(--card-border)", height: 40 }}>
                <div
                  className="shrink-0 w-[200px] p-2 text-sm truncate cursor-pointer"
                  style={{ position: "sticky", left: 0, background: "var(--card)", zIndex: 2 }}
                  onClick={() => onOpenTask(task.id)}
                >
                  <span style={{ color: "var(--muted)" }}>{statusName(task.statusId)} · </span>
                  {task.title}
                </div>
                <div className="relative flex-1">
                  {/* today line */}
                  <div
                    className="absolute top-0 bottom-0"
                    style={{ left: x(today), width: 1, background: "var(--accent)", zIndex: 1 }}
                  />
                  {r && r.diamond ? (
                    <div
                      className="absolute cursor-pointer"
                      style={{ left: r.left, top: 12, width: 12, height: 12, transform: "rotate(45deg)", background: "var(--accent)" }}
                      onClick={() => onOpenTask(task.id)}
                    />
                  ) : r ? (
                    <div
                      className="absolute cursor-grab touch-none select-none rounded-sm"
                      style={{
                        left: r.left + 2,
                        top: 8,
                        width: Math.max(r.width - 4, 8),
                        height: 22,
                        background: pastDue ? "var(--danger)" : "var(--accent)",
                        opacity: 0.85,
                        border: pastDue ? "2px solid var(--danger)" : "none",
                      }}
                      onPointerDown={(e) => onPointerDown(task, "move", e)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onClick={() => onOpenTask(task.id)}
                    >
                      {task.progress > 0 && (
                        <div
                          className="absolute left-0 top-0 bottom-0 rounded-l-sm"
                          style={{ width: `${task.progress}%`, background: "rgba(255,255,255,0.35)" }}
                        />
                      )}
                      {/* Resize handles */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize"
                        style={{ background: "transparent" }}
                        onPointerDown={(e) => onPointerDown(task, "resize-start", e)}
                      />
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize"
                        style={{ background: "transparent" }}
                        onPointerDown={(e) => onPointerDown(task, "resize-end", e)}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-medium mb-2" style={{ color: "var(--muted)" }}>
            Unscheduled
          </h3>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((t) => (
              <span key={t.id} className="chip chip-grey cursor-pointer" onClick={() => onOpenTask(t.id)}>
                {t.title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
