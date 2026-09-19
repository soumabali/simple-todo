"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { BoardData } from "@/app/(app)/boards/[id]/page";

type Task = BoardData["tasks"][number];
type Status = BoardData["statuses"][number];
type Label = BoardData["labels"][number];

const DAY = 86400000;
const PANEL_W = 248;
const MONTH_H = 26;
const DAY_H = 28;
const ROW_H = 38;
const BASE_WIDTH = 2300; // timeline px budget before zoom

type Preset = "1m" | "3m" | "6m" | "1y" | "all";
const PRESETS: { key: Preset; label: string; before: number; after: number }[] = [
  { key: "1m", label: "1M", before: 15, after: 15 },
  { key: "3m", label: "3M", before: 45, after: 45 },
  { key: "6m", label: "6M", before: 90, after: 90 },
  { key: "1y", label: "1Y", before: 182, after: 182 },
  { key: "all", label: "All", before: 0, after: 0 },
];

type SortKey = "near" | "start" | "priority";
type DragMode = "move" | "resize-start" | "resize-end";

/* ---------- date helpers (local-time safe: no toISOString) ---------- */

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function toDate(s: string | null): Date | null {
  return s ? new Date(s + "T00:00:00") : null;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function fmt(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}
function prettyDate(s: string): string {
  const d = toDate(s);
  return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/* ---------- persisted (localStorage) preferences ---------- */

function usePref<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
  }, [key]);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [value, set];
}

export function GanttView({ data, onOpenTask }: { data: BoardData; onOpenTask: (id: string) => void }) {
  const qc = useQueryClient();

  const [preset, setPreset] = usePref<Preset>("gantt.preset", "3m");
  const [zoom, setZoom] = usePref<number>("gantt.zoom", 1);
  const [showCompleted, setShowCompleted] = usePref<boolean>("gantt.showCompleted", false);
  const [sortKey, setSortKey] = usePref<SortKey>("gantt.sort", "near");
  const [grouped, setGrouped] = usePref<boolean>("gantt.grouped", true);
  const [showUnscheduled, setShowUnscheduled] = useState(true);

  const [preview, setPreview] = useState<Record<string, { startDate: string | null; dueDate: string | null }>>({});
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [tip, setTip] = useState<{ task: Task; x: number; y: number } | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    mode: DragMode;
    startX: number;
    origStart: string | null;
    origDue: string | null;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const today = useMemo(() => startOfDay(new Date()), []);
  const statusById = useMemo(() => {
    const m = new Map<string, Status>();
    for (const s of data.statuses) m.set(s.id, s);
    return m;
  }, [data.statuses]);

  /* ---------- which tasks render ---------- */

  const visibleTasks = useMemo(() => {
    return data.tasks.filter((t) => {
      const st = statusById.get(t.statusId);
      if (!showCompleted && (st?.isDone || t.completedAt)) return false;
      return true;
    });
  }, [data.tasks, statusById, showCompleted]);

  const hiddenCount = data.tasks.length - visibleTasks.length;

  const scheduled = useMemo(
    () => visibleTasks.filter((t) => effective(t).startDate || effective(t).dueDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleTasks, preview],
  );
  const unscheduled = useMemo(
    () => visibleTasks.filter((t) => !effective(t).startDate && !effective(t).dueDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleTasks, preview],
  );

  function effective(task: Task): { startDate: string | null; dueDate: string | null } {
    return preview[task.id] ?? { startDate: task.startDate, dueDate: task.dueDate };
  }

  /* ---------- today-centred render window ---------- */

  const [rangeStart, rangeEnd] = useMemo(() => {
    const t = today;
    if (preset !== "all") {
      const p = PRESETS.find((x) => x.key === preset)!;
      return [addDays(t, -p.before), addDays(t, p.after)] as const;
    }
    // "All": span every dated task plus today, with a little breathing room.
    let lo = t;
    let hi = t;
    for (const task of data.tasks) {
      for (const s of [task.startDate, task.dueDate]) {
        const d = toDate(s);
        if (!d) continue;
        if (d < lo) lo = d;
        if (d > hi) hi = d;
      }
    }
    const span = Math.round((hi.getTime() - lo.getTime()) / DAY);
    if (span <= 60) {
      return [addDays(t, -30), addDays(t, 30)] as const;
    }
    return [addDays(lo, -7), addDays(hi, 7)] as const;
  }, [preset, today, data.tasks]);

  const days = useMemo(() => {
    const out: Date[] = [];
    for (let d = new Date(rangeStart); d <= rangeEnd; d = addDays(d, 1)) out.push(new Date(d));
    return out;
  }, [rangeStart, rangeEnd]);

  const dayWidth = useMemo(
    () => clamp((BASE_WIDTH / Math.max(days.length, 1)) * zoom, 2.5, 72),
    [days.length, zoom],
  );

  const totalW = days.length * dayWidth;
  const showDays = dayWidth >= 15;

  const x = useCallback(
    (d: Date) => ((d.getTime() - rangeStart.getTime()) / DAY) * dayWidth,
    [rangeStart, dayWidth],
  );
  const todayX = useMemo(() => x(today), [x, today]);

  // Weekend shading as ONE repeating gradient (weekends repeat every 7 days).
  const weekendBg = useMemo(() => {
    const idx = days.findIndex((d) => d.getDay() === 6);
    if (idx < 0) return "none";
    const period = 7 * dayWidth;
    const a = idx * dayWidth;
    const b = (idx + 2) * dayWidth;
    return `repeating-linear-gradient(to right, transparent 0px, transparent ${a}px, var(--gantt-weekend) ${a}px, var(--gantt-weekend) ${b}px, transparent ${b}px, transparent ${period}px)`;
  }, [days, dayWidth]);

  const months = useMemo(() => {
    const out: { key: number; label: string; offset: number; width: number }[] = [];
    days.forEach((d, i) => {
      const key = d.getFullYear() * 12 + d.getMonth();
      const last = out[out.length - 1];
      if (last && last.key === key) last.width += dayWidth;
      else
        out.push({
          key,
          label: d.toLocaleDateString("en-GB", { month: "long", year: "numeric" }),
          offset: i * dayWidth,
          width: dayWidth,
        });
    });
    return out;
  }, [days, dayWidth]);

  /* ---------- keep today centred ---------- */

  const scrollToToday = useCallback(
    (smooth: boolean) => {
      const el = scrollerRef.current;
      if (!el) return;
      const timelineView = Math.max(el.clientWidth - PANEL_W, 120);
      const target = Math.max(0, todayX - timelineView / 2);
      el.scrollTo({ left: target, behavior: smooth ? "smooth" : "auto" });
    },
    [todayX],
  );

  // Centre on mount + whenever the window/zoom changes (so "today" never drifts away).
  useLayoutEffect(() => {
    scrollToToday(false);
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => scrollToToday(false));
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollToToday]);

  // Track whether the panel is overlaying content (drives the drop shadow).
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => setScrolled((prev) => {
      const next = el.scrollLeft > 2;
      return prev === next ? prev : next;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  /* ---------- persistence of drag ---------- */

  const scheduleMutation = useMutation({
    mutationFn: (v: { id: string; startDate: string | null; dueDate: string | null }) =>
      api(`/api/tasks/${v.id}/schedule`, { method: "PATCH", body: JSON.stringify(v) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
  });

  function onPointerDown(task: Task, mode: DragMode, e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    const eff = effective(task);
    dragRef.current = {
      id: task.id,
      mode,
      startX: e.clientX,
      origStart: eff.startDate,
      origDue: eff.dueDate,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const ds = dragRef.current;
    if (!ds) return;
    const deltaDays = Math.round((e.clientX - ds.startX) / dayWidth);
    ds.moved = ds.moved || deltaDays !== 0;

    let startDate = ds.origStart;
    let dueDate = ds.origDue;

    if (ds.mode === "move") {
      if (ds.origStart) startDate = fmt(addDays(toDate(ds.origStart)!, deltaDays));
      if (ds.origDue) dueDate = fmt(addDays(toDate(ds.origDue)!, deltaDays));
    } else if (ds.mode === "resize-start") {
      if (ds.origStart) {
        const next = fmt(addDays(toDate(ds.origStart)!, deltaDays));
        if (!dueDate || next <= dueDate) startDate = next;
      }
    } else if (ds.mode === "resize-end") {
      if (ds.origDue) {
        const next = fmt(addDays(toDate(ds.origDue)!, deltaDays));
        if (!startDate || next >= startDate) dueDate = next;
      }
    }

    setPreview((p) => ({ ...p, [ds.id]: { startDate, dueDate } }));
  }

  function onPointerUp() {
    const ds = dragRef.current;
    if (!ds) return;
    dragRef.current = null;
    const p = preview[ds.id];
    if (!ds.moved || !p) {
      setPreview((prev) => {
        const next = { ...prev };
        delete next[ds.id];
        return next;
      });
      suppressClickRef.current = false;
      return;
    }
    suppressClickRef.current = true;
    scheduleMutation.mutate({ id: ds.id, startDate: p.startDate, dueDate: p.dueDate });
    setPreview((prev) => {
      const next = { ...prev };
      delete next[ds.id];
      return next;
    });
  }

  function handleBarClick(taskId: string) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onOpenTask(taskId);
  }

  /* ---------- ordering ---------- */

  const sorted = useMemo(() => {
    const list = [...scheduled];
    const ref = (t: Task) => {
      const e = effective(t);
      return toDate(e.startDate) ?? toDate(e.dueDate) ?? null;
    };
    if (sortKey === "near") {
      list.sort((a, b) => {
        const ra = ref(a);
        const rb = ref(b);
        if (!ra && !rb) return a.title.localeCompare(b.title);
        if (!ra) return 1;
        if (!rb) return -1;
        const da = Math.abs(ra.getTime() - today.getTime());
        const db = Math.abs(rb.getTime() - today.getTime());
        if (da !== db) return da - db;
        return ra.getTime() - rb.getTime();
      });
    } else if (sortKey === "start") {
      list.sort((a, b) => {
        const ra = ref(a);
        const rb = ref(b);
        if (!ra && !rb) return 0;
        if (!ra) return 1;
        if (!rb) return -1;
        return ra.getTime() - rb.getTime();
      });
    } else {
      const rank = (t: Task) => {
        const r = ref(t);
        return r ? r.getTime() : Number.POSITIVE_INFINITY;
      };
      list.sort((a, b) => a.priority - b.priority || rank(a) - rank(b));
    }
    return list;
  }, [scheduled, sortKey, today, preview]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = useMemo(() => {
    const ordered = [...data.statuses].sort((a, b) => Number(a.position) - Number(b.position));
    if (!grouped) return [{ status: null as Status | null, tasks: sorted }];
    const out: { status: Status | null; tasks: Task[] }[] = [];
    for (const s of ordered) {
      const tasks = sorted.filter((t) => t.statusId === s.id);
      if (tasks.length) out.push({ status: s, tasks });
    }
    const orphan = sorted.filter((t) => !statusById.has(t.statusId));
    if (orphan.length) out.push({ status: null, tasks: orphan });
    return out;
  }, [grouped, sorted, data.statuses, statusById]);

  const rowsH = sorted.length * ROW_H + (grouped ? sections.length * 30 : 0);
  const headH = MONTH_H + (showDays ? DAY_H : 0);

  const labelsFor = useCallback(
    (taskId: string): Label[] => {
      const ids = data.taskLabels.filter((tl) => tl.taskId === taskId).map((tl) => tl.labelId);
      return data.labels.filter((l) => ids.includes(l.id)).slice(0, 2);
    },
    [data.taskLabels, data.labels],
  );

  const statusName = useCallback(
    (id: string) => statusById.get(id)?.name ?? "",
    [statusById],
  );
  const statusColor = useCallback(
    (id: string) => `var(--${statusById.get(id)?.color ?? "slate"})`,
    [statusById],
  );

  /* ---------- bar geometry ---------- */

  function barFor(task: Task) {
    const e = effective(task);
    const s = toDate(e.startDate);
    const d = toDate(e.dueDate);
    if (!s && d) return { kind: "milestone" as const, left: x(d) - 6, width: 12 };
    if (s && d) {
      const left = x(s);
      const width = Math.max(((d.getTime() - s.getTime()) / DAY) * dayWidth + dayWidth - 3, 6);
      return { kind: "bar" as const, left, width };
    }
    if (s) return { kind: "open" as const, left: x(s), width: Math.max(dayWidth - 3, 6) };
    return null;
  }

  /* ---------- render ---------- */

  return (
    <div>
      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <div className="flex items-center rounded-lg overflow-hidden" style={{ border: "1px solid var(--card-border)" }}>
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className="px-2.5 py-1 text-xs font-medium"
              style={
                preset === p.key
                  ? { background: "var(--accent)", color: "#fff" }
                  : { color: "var(--muted)" }
              }
              onClick={() => setPreset(p.key)}
              title={p.key === "all" ? "Fit every scheduled task" : `Show ${p.label} around today`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button className="btn btn-ghost text-xs py-1" onClick={() => scrollToToday(true)} title="Re-centre the timeline on today">
          <span style={{ color: "var(--accent)" }}>◎</span> Today
        </button>

        <label className="flex items-center gap-2 text-xs" style={{ color: "var(--muted)" }}>
          Zoom
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ width: 90, accentColor: "var(--accent)" }}
            aria-label="Timeline zoom"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--muted)" }}>
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
          />
          Show completed
          {hiddenCount > 0 && (
            <span
              className="px-1.5 rounded-full text-[10px]"
              style={{ background: "var(--gantt-weekend)", border: "1px solid var(--card-border)" }}
              title={`${hiddenCount} task${hiddenCount === 1 ? "" : "s"} hidden`}
            >
              {hiddenCount} hidden
            </span>
          )}
        </label>

        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: "var(--muted)" }}>
          <input
            type="checkbox"
            checked={grouped}
            onChange={(e) => setGrouped(e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
          />
          Group by status
        </label>

        <label className="flex items-center gap-1.5 text-xs" style={{ color: "var(--muted)" }}>
          Sort
          <select
            className="text-xs rounded-md px-1.5 py-1"
            style={{ background: "var(--card)", border: "1px solid var(--card-border)", color: "var(--foreground)" }}
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
          >
            <option value="near">Nearest to today</option>
            <option value="start">Start date</option>
            <option value="priority">Priority</option>
          </select>
        </label>

        <span className="ml-auto text-[11px] hidden lg:inline" style={{ color: "var(--muted)" }}>
          Drag to move · drag edges to resize · click to open
        </span>
      </div>

      {/* ── Grid ──────────────────────────────────────────────── */}
      {sorted.length === 0 ? (
        <div
          className="card flex flex-col items-center justify-center text-center"
          style={{ padding: "48px 24px" }}
        >
          <div style={{ fontSize: 28, opacity: 0.35, marginBottom: 8 }}>▤</div>
          <div className="text-sm font-medium">No scheduled tasks in this window</div>
          <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            {hiddenCount > 0 ? (
              <>Tick <strong>Show completed</strong> to include {hiddenCount} hidden task{hiddenCount === 1 ? "" : "s"}.</>
            ) : unscheduled.length > 0 ? (
              <>Drag a task onto the timeline, or open one and set a start / due date.</>
            ) : (
              <>Add a task with a start or due date to see it on the timeline.</>
            )}
          </div>
        </div>
      ) : (
        <div
          ref={scrollerRef}
          className="card overflow-x-auto overflow-y-auto"
          style={{ maxHeight: "70vh" }}
        >
          <div style={{ width: PANEL_W + totalW, position: "relative" }}>
            {/* Header */}
            <div
              className="flex sticky top-0"
              style={{ zIndex: 30, background: "var(--card)", borderBottom: "1px solid var(--card-border)" }}
            >
              <div
                className="shrink-0 flex items-end px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide"
                style={{
                  width: PANEL_W,
                  height: headH,
                  position: "sticky",
                  left: 0,
                  zIndex: 32,
                  background: "var(--card)",
                  color: "var(--muted)",
                  borderRight: "1px solid var(--card-border)",
                  boxShadow: scrolled ? "6px 0 12px -8px rgb(0 0 0 / 0.35)" : "none",
                }}
              >
                Task
              </div>

              <div style={{ width: totalW, position: "relative", background: weekendBg }}>
                {/* month band */}
                <div style={{ position: "relative", height: MONTH_H }}>
                  {months.map((m) => (
                    <div
                      key={m.key}
                      className="absolute top-0 bottom-0 flex items-center px-2 text-[11px] font-medium truncate"
                      style={{
                        left: m.offset,
                        width: m.width,
                        color: "var(--muted)",
                        borderLeft: "1px solid var(--card-border)",
                      }}
                    >
                      {m.width > 46 ? m.label : m.label.slice(0, 3)}
                    </div>
                  ))}
                  {/* today pill */}
                  {todayX >= 0 && todayX <= totalW && (
                    <div
                      className="absolute flex items-center justify-center text-[10px] font-semibold"
                      style={{
                        left: todayX - 25,
                        top: 4,
                        width: 50,
                        height: 18,
                        borderRadius: 999,
                        background: "var(--accent)",
                        color: "#fff",
                        letterSpacing: "0.02em",
                        boxShadow: "0 2px 6px -1px color-mix(in srgb, var(--accent) 55%, transparent)",
                      }}
                    >
                      Today
                    </div>
                  )}
                </div>

                {/* day band */}
                {showDays && (
                  <div style={{ position: "relative", height: DAY_H }}>
                    {days.map((d, i) => {
                      const isToday = fmt(d) === fmt(today);
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      return (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 flex flex-col items-center justify-center text-[10px]"
                          style={{
                            left: i * dayWidth,
                            width: dayWidth,
                            borderLeft: "1px solid var(--gantt-line)",
                            background: isToday ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                            color: isToday ? "var(--accent)" : isWeekend ? "var(--muted)" : "var(--foreground)",
                            fontWeight: isToday ? 700 : 400,
                            opacity: isWeekend && !isToday ? 0.6 : 1,
                          }}
                        >
                          <span style={{ lineHeight: 1 }}>{d.getDate()}</span>
                          {dayWidth >= 26 && (
                            <span style={{ fontSize: 8, opacity: 0.7, lineHeight: 1.2 }}>
                              {["S", "M", "T", "W", "T", "F", "S"][d.getDay()]}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Rows */}
            <div style={{ position: "relative", height: rowsH }}>
              {/* Subtle "today" column band, so the eye lands there instantly */}
              {todayX >= 0 && todayX <= totalW && (
                <div
                  className="absolute"
                  style={{
                    left: PANEL_W + todayX,
                    top: 0,
                    bottom: 0,
                    width: dayWidth,
                    background: "color-mix(in srgb, var(--accent) 7%, transparent)",
                    zIndex: 1,
                    pointerEvents: "none",
                  }}
                />
              )}

              {/* Full-height today marker */}
              {todayX >= 0 && todayX <= totalW && (
                <div
                  className="absolute"
                  style={{
                    left: PANEL_W + todayX,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background:
                      "linear-gradient(180deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 45%, transparent) 100%)",
                    opacity: 0.7,
                    zIndex: 5,
                    pointerEvents: "none",
                  }}
                />
              )}

              {sections.map((section) => (
                <div key={section.status?.id ?? "orphan"}>
                  {section.status && (
                    <div className="flex" style={{ height: 30 }}>
                      <div
                        className="shrink-0 flex items-center gap-2 px-3 text-[10px] font-bold uppercase"
                        style={{
                          width: PANEL_W,
                          position: "sticky",
                          left: 0,
                          zIndex: 20,
                          letterSpacing: "0.08em",
                          background: "var(--card-hover-bg)",
                          borderRight: "1px solid var(--card-border)",
                          borderBottom: "1px solid var(--card-border)",
                          boxShadow: scrolled ? "6px 0 12px -8px rgb(0 0 0 / 0.35)" : "none",
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 2,
                            background: `var(--${section.status.color})`,
                            flexShrink: 0,
                            boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 0.35)",
                          }}
                        />
                        <span className="truncate" style={{ color: "var(--foreground)", opacity: 0.75 }}>
                          {section.status.name}
                        </span>
                        <span style={{ color: "var(--muted)", opacity: 0.8, fontWeight: 500 }}>
                          {section.tasks.length}
                        </span>
                      </div>
                      <div
                        style={{
                          width: totalW,
                          background: weekendBg,
                          borderTop: "1px solid var(--gantt-line)",
                          borderBottom: "1px solid var(--gantt-line)",
                        }}
                      />
                    </div>
                  )}

                  {section.tasks.map((task) => {
                    const bar = barFor(task);
                    const e = effective(task);
                    const st = statusById.get(task.statusId);
                    const isDone = Boolean(st?.isDone);
                    const overdue =
                      Boolean(e.dueDate) && !isDone && (e.dueDate as string) < fmt(today);
                    const color = statusColor(task.statusId);
                    const labels = labelsFor(task.id);
                    const isHover = hoverId === task.id;

                    return (
                      <div key={task.id} className="flex" style={{ height: ROW_H }}>
                        {/* Task panel cell */}
                        <div
                          className="shrink-0 flex items-center gap-2 px-3 cursor-pointer"
                          style={{
                            width: PANEL_W,
                            position: "sticky",
                            left: 0,
                            zIndex: 20,
                            background: isHover ? "var(--card-hover-bg)" : "var(--card)",
                            borderRight: "1px solid var(--card-border)",
                            borderBottom: "1px solid var(--gantt-line)",
                            boxShadow: scrolled ? "6px 0 12px -8px rgb(0 0 0 / 0.35)" : "none",
                          }}
                          onMouseEnter={() => setHoverId(task.id)}
                          onMouseLeave={() => setHoverId(null)}
                          onClick={() => onOpenTask(task.id)}
                          title={task.title}
                        >
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: color,
                              flexShrink: 0,
                              opacity: isDone ? 0.45 : 1,
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div
                              className="text-[13px] truncate"
                              style={{
                                textDecoration: isDone ? "line-through" : "none",
                                opacity: isDone ? 0.6 : 1,
                              }}
                            >
                              {task.title}
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--muted)" }}>
                              <span>
                                {e.startDate && e.dueDate
                                  ? `${prettyDate(e.startDate)} → ${prettyDate(e.dueDate)}`
                                  : e.dueDate
                                    ? `Due ${prettyDate(e.dueDate)}`
                                    : e.startDate
                                      ? `Starts ${prettyDate(e.startDate)}`
                                      : ""}
                              </span>
                              {overdue && (
                                <span className="font-semibold" style={{ color: "var(--danger)" }}>
                                  overdue
                                </span>
                              )}
                              {task.progress > 0 && <span>{task.progress}%</span>}
                            </div>
                          </div>
                          {labels.map((l) => (
                            <span
                              key={l.id}
                              className="shrink-0"
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: 999,
                                background: `var(--${l.color})`,
                              }}
                              title={l.name}
                            />
                          ))}
                        </div>

                        {/* Timeline cell */}
                        <div
                          style={{
                            width: totalW,
                            position: "relative",
                            background: isHover ? "var(--card-hover-bg)" : "var(--card)",
                            borderBottom: "1px solid var(--gantt-line)",
                          }}
                          onMouseEnter={() => setHoverId(task.id)}
                          onMouseLeave={() => setHoverId(null)}
                        >
                          <div className="absolute inset-0" style={{ background: weekendBg }} />
                          {bar && (
                            <div
                              role="button"
                              tabIndex={0}
                              aria-label={`${task.title} — ${statusName(task.statusId)}`}
                              className={`absolute touch-none select-none ${bar.kind === "milestone" ? "cursor-pointer" : "cursor-grab"}`}
                              onPointerDown={(ev) => bar.kind !== "milestone" && onPointerDown(task, "move", ev)}
                              onPointerMove={onPointerMove}
                              onPointerUp={onPointerUp}
                              onClick={() => handleBarClick(task.id)}
                              onKeyDown={(ev) => {
                                if (ev.key === "Enter" || ev.key === " ") {
                                  ev.preventDefault();
                                  onOpenTask(task.id);
                                }
                              }}
                              onMouseEnter={(ev) => {
                                setHoverId(task.id);
                                setTip({ task, x: ev.clientX, y: ev.clientY });
                              }}
                              onMouseMove={(ev) => setTip((t) => (t && t.task.id === task.id ? { ...t, x: ev.clientX, y: ev.clientY } : t))}
                              onMouseLeave={() => setTip(null)}
                              style={
                                bar.kind === "milestone"
                                  ? {
                                      left: bar.left,
                                      top: ROW_H / 2 - 6,
                                      width: 12,
                                      height: 12,
                                      background: color,
                                      transform: "rotate(45deg)",
                                      borderRadius: 2,
                                      boxShadow: "0 1px 3px rgb(0 0 0 / 0.3)",
                                      zIndex: 10,
                                    }
                                  : {
                                      left: bar.left + 1.5,
                                      top: 8,
                                      width: bar.width,
                                      height: ROW_H - 16,
                                      background: overdue
                                        ? "linear-gradient(180deg, color-mix(in srgb, var(--danger) 88%, #fff) 0%, var(--danger) 100%)"
                                        : `linear-gradient(180deg, color-mix(in srgb, ${color} 82%, #fff) 0%, ${color} 100%)`,
                                      borderRadius: 7,
                                      opacity: isDone ? 0.4 : 1,
                                      boxShadow: isHover
                                        ? "inset 0 1px 0 rgb(255 255 255 / 0.35), 0 4px 12px -2px rgb(0 0 0 / 0.3)"
                                        : "inset 0 1px 0 rgb(255 255 255 / 0.28), 0 1px 2px rgb(0 0 0 / 0.18)",
                                      border: bar.kind === "open" ? `1.5px dashed rgb(255 255 255 / 0.85)` : "none",
                                      outline: isHover ? "2px solid color-mix(in srgb, var(--accent) 55%, transparent)" : "none",
                                      outlineOffset: 1,
                                      zIndex: isHover ? 11 : 10,
                                      overflow: "hidden",
                                      display: "flex",
                                      alignItems: "center",
                                      transition: "box-shadow 120ms ease, opacity 120ms ease",
                                    }
                              }
                            >
                              {bar.kind !== "milestone" && (
                                <div
                                  className="absolute left-0 top-0 bottom-0"
                                  style={{
                                    width: 3,
                                    background: overdue ? "rgb(255 255 255 / 0.5)" : color,
                                    opacity: 0.9,
                                    zIndex: 3,
                                  }}
                                />
                              )}
                              {bar.kind !== "milestone" && task.progress > 0 && (
                                <div
                                  className="absolute left-0 top-0 bottom-0"
                                  style={{
                                    width: `${task.progress}%`,
                                    background: "rgb(255 255 255 / 0.28)",
                                    borderRadius: 7,
                                    boxShadow: "inset -1px 0 0 rgb(255 255 255 / 0.55)",
                                    zIndex: 2,
                                  }}
                                />
                              )}
                              {bar.kind !== "milestone" && bar.width > 90 && (
                                <span
                                  className="relative px-2 text-[10px] font-medium truncate"
                                  style={{ color: "#fff", textShadow: "0 1px 1px rgb(0 0 0 / 0.25)" }}
                                >
                                  {task.title}
                                </span>
                              )}
                              {bar.kind !== "milestone" && (
                                <>
                                  <div
                                    className="absolute left-0 top-0 bottom-0 cursor-ew-resize"
                                    style={{ width: 7 }}
                                    onPointerDown={(ev) => onPointerDown(task, "resize-start", ev)}
                                    onPointerMove={onPointerMove}
                                    onPointerUp={onPointerUp}
                                  />
                                  <div
                                    className="absolute right-0 top-0 bottom-0 cursor-ew-resize"
                                    style={{ width: 7 }}
                                    onPointerDown={(ev) => onPointerDown(task, "resize-end", ev)}
                                    onPointerMove={onPointerMove}
                                    onPointerUp={onPointerUp}
                                  />
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Unscheduled ──────────────────────────────────────── */}
      {unscheduled.length > 0 && (
        <div className="mt-3">
          <button
            className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--muted)" }}
            onClick={() => setShowUnscheduled((v) => !v)}
            aria-expanded={showUnscheduled}
          >
            <span style={{ transform: showUnscheduled ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>
              ▸
            </span>
            Unscheduled
            <span className="px-1.5 rounded-full text-[10px] font-normal" style={{ background: "var(--gantt-weekend)", border: "1px solid var(--card-border)" }}>
              {unscheduled.length}
            </span>
          </button>
          {showUnscheduled && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {unscheduled.map((t) => (
                <button
                  key={t.id}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs"
                  style={{ background: "var(--card)", border: "1px solid var(--card-border)" }}
                  onClick={() => onOpenTask(t.id)}
                  title={`${statusName(t.statusId)} · no dates yet`}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: statusColor(t.statusId) }} />
                  {t.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Hover tooltip ────────────────────────────────────── */}
      {tip && (
        <div
          className="fixed pointer-events-none rounded-lg px-2.5 py-2 text-xs"
          style={{
            left: Math.min(tip.x + 14, window.innerWidth - 230),
            top: Math.min(tip.y + 14, window.innerHeight - 110),
            zIndex: 60,
            background: "var(--card)",
            border: "1px solid var(--card-border)",
            boxShadow: "0 6px 20px rgb(0 0 0 / 0.22)",
            maxWidth: 220,
          }}
        >
          <div className="font-medium truncate">{tip.task.title}</div>
          <div className="mt-0.5" style={{ color: "var(--muted)" }}>
            {statusName(tip.task.statusId)} · P{tip.task.priority}
          </div>
          <div style={{ color: "var(--muted)" }}>
            {(() => {
              const e = effective(tip.task);
              const a = e.startDate ? prettyDate(e.startDate) : null;
              const b = e.dueDate ? prettyDate(e.dueDate) : null;
              if (a && b) {
                const span = (toDate(e.dueDate)!.getTime() - toDate(e.startDate)!.getTime()) / DAY + 1;
                return `${a} → ${b} · ${span}d`;
              }
              if (b) return `Due ${b}`;
              if (a) return `Starts ${a}`;
              return "No dates";
            })()}
          </div>
          {tip.task.progress > 0 && <div style={{ color: "var(--muted)" }}>{tip.task.progress}% complete</div>}
        </div>
      )}
    </div>
  );
}
