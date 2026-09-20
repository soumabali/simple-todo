"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { BoardData } from "@/app/(app)/boards/[id]/page";
import { ConfirmDialog } from "./confirm-dialog";

export function TaskDetail({ data, taskId, onClose }: { data: BoardData; taskId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const task = data.tasks.find((t) => t.id === taskId);
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [startDate, setStartDate] = useState(task?.startDate ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [dueTime, setDueTime] = useState(task?.dueTime ? String(task.dueTime).slice(0, 5) : "");
  const [remindOnStart, setRemindOnStart] = useState(task?.remindOnStart ?? false);
  const [remindersMuted, setRemindersMuted] = useState(task?.remindersMuted ?? false);
  const [leadInput, setLeadInput] = useState(
    task?.remindLeadMinutes !== null && task?.remindLeadMinutes !== undefined ? String(task.remindLeadMinutes) : ""
  );
  const [priority, setPriority] = useState(task?.priority ?? 2);
  const [progress, setProgress] = useState(task?.progress ?? 0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState("slate");

  const subtasks = useMemo(
    () => data.subtasks.filter((s) => s.taskId === taskId).sort((a, b) => Number(a.position) - Number(b.position)),
    [data.subtasks, taskId]
  );
  const doneCount = subtasks.filter((s) => s.isDone).length;

  const taskLabels = useMemo(
    () => data.taskLabels.filter((tl) => tl.taskId === taskId).map((tl) => tl.labelId),
    [data.taskLabels, taskId]
  );
  const availableLabels = data.labels;

  // Wrap every mutation so the drawer shows "Saving… / Saved ✓ / Failed" (U2).
  function withFeedback<T>(fn: () => Promise<T>) {
    setSaveState("saving");
    setSaveError("");
    return fn()
      .then((r) => {
        setSaveState("saved");
        window.setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 1500);
        return r;
      })
      .catch((e: Error) => {
        setSaveState("error");
        setSaveError(e?.message ?? "Save failed");
        throw e;
      });
  }

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      withFeedback(() => api(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(body) })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
  });

  const schedule = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      withFeedback(() => api(`/api/tasks/${taskId}/schedule`, { method: "PATCH", body: JSON.stringify(body) })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
  });

  // Per-task reminder overrides (PRD F-4.3). The API has existed since the
  // reminder engine shipped; the drawer just never exposed it, so every task
  // was stuck on the board-wide defaults.
  const reminders = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      withFeedback(() => api(`/api/tasks/${taskId}/reminders`, { method: "PATCH", body: JSON.stringify(body) })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
  });

  const remove = useMutation({
    mutationFn: () => api(`/api/tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", data.board.id] });
      onClose();
    },
  });

  const addSubtask = useMutation({
    mutationFn: (t: string) => api(`/api/tasks/${taskId}/subtasks`, { method: "POST", body: JSON.stringify({ title: t }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
  });

  const toggleLabel = useMutation({
    mutationFn: (v: { labelId: string; on: boolean }) =>
      api(`/api/tasks/${taskId}/labels`, {
        method: v.on ? "POST" : "DELETE",
        body: JSON.stringify({ labelId: v.labelId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
    onError: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
  });

  const createLabel = useMutation({
    mutationFn: (name: string) =>
      api<{ label: { id: string } }>(`/api/boards/${data.board.id}/labels`, {
        method: "POST",
        body: JSON.stringify({ name, color: newLabelColor }),
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["board", data.board.id] });
      // Auto-attach the freshly created label to this task.
      if (res?.label?.id) toggleLabel.mutate({ labelId: res.label.id, on: true });
      setNewLabelName("");
    },
  });

  const toggleSubtask = useMutation({
    mutationFn: (v: { subId: string; isDone: boolean }) =>
      api(`/api/tasks/${taskId}/subtasks/${v.subId}`, { method: "PATCH", body: JSON.stringify({ isDone: v.isDone }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["board", data.board.id] }),
  });

  // Close on Escape (matches ConfirmDialog). Declared before the early return
  // so the hook order stays stable when the task disappears.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!task) return null;

  const dateError = startDate && dueDate && startDate > dueDate;

  function saveSchedule() {
    if (dateError) return;
    schedule.mutate({ startDate: startDate || null, dueDate: dueDate || null, dueTime: dueTime || null });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "rgba(0,0,0,0.3)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Task detail"
    >
      <div
        className="w-full max-w-md h-full overflow-y-auto p-6"
        style={{ background: "var(--background)", borderLeft: "1px solid var(--card-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold">Task detail</h2>
            <div className="h-4 text-xs" aria-live="polite">
              {saveState === "saving" && <span style={{ color: "var(--muted)" }}>Saving…</span>}
              {saveState === "saved" && <span style={{ color: "var(--success)" }}>Saved ✓</span>}
              {saveState === "error" && <span style={{ color: "var(--danger)" }}>Save failed: {saveError}</span>}
            </div>
          </div>
          <button className="btn btn-ghost text-sm" onClick={onClose}>✕</button>
        </div>

        {availableLabels.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm mb-1">Labels</label>
            <div className="flex flex-wrap gap-1">
              {availableLabels.map((l) => {
                const on = taskLabels.includes(l.id);
                return (
                  <button
                    key={l.id}
                    className="text-xs px-2 py-1 rounded-full"
                    style={{
                      background: on ? `var(--${l.color})` : "transparent",
                      color: on ? "#fff" : "var(--muted)",
                      border: `1px solid var(--${l.color})`,
                    }}
                    onClick={() => toggleLabel.mutate({ labelId: l.id, on: !on })}
                  >
                    {on ? "✓ " : ""}{l.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm mb-1">Add label</label>
          <form
            className="flex gap-1 items-center"
            onSubmit={(e) => {
              e.preventDefault();
              if (newLabelName.trim()) createLabel.mutate(newLabelName.trim());
            }}
          >
            <input
              className="input flex-1"
              placeholder="New label name…"
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              maxLength={30}
            />
            {["slate", "indigo", "sky", "emerald", "amber", "rose", "violet"].map((c) => (
              <button
                type="button"
                key={c}
                aria-label={`Label color ${c}`}
                className="w-4 h-4 rounded-full shrink-0"
                style={{ background: `var(--${c})`, outline: newLabelColor === c ? "2px solid var(--accent)" : "none", outlineOffset: 1 }}
                onClick={() => setNewLabelColor(c)}
              />
            ))}
            <button className="btn btn-ghost text-xs" disabled={!newLabelName.trim() || createLabel.isPending}>
              Add
            </button>
          </form>
          {createLabel.isError && (
            <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>
              {(createLabel.error as Error)?.message ?? "Could not create label"}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== task.title && update.mutate({ title })} />
          </div>

          <div>
            <label className="block text-sm mb-1">Description</label>
            <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== task.description && update.mutate({ description })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Start date</label>
              <input type="date" className="input" value={startDate} onChange={(e) => { setStartDate(e.target.value); }} onBlur={saveSchedule} />
            </div>
            <div>
              <label className="block text-sm mb-1">Due date</label>
              <input type="date" className="input" value={dueDate} onChange={(e) => { setDueDate(e.target.value); }} onBlur={saveSchedule} />
            </div>
          </div>
          {dateError && (
            <div className="text-sm" style={{ color: "var(--danger)" }}>
              Start date must be before or equal to due date.
            </div>
          )}

          {/* Due time drives the due_soon reminder: without it the engine falls
              back to the board-wide default delivery time. */}
          <div>
            <label className="block text-sm mb-1">Due time (optional)</label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                className="input"
                value={dueTime}
                disabled={!dueDate}
                aria-label="Due time"
                onChange={(e) => { setDueTime(e.target.value); }}
                onBlur={saveSchedule}
              />
              {dueTime && (
                <button type="button" className="btn btn-ghost text-xs" onClick={() => { setDueTime(""); schedule.mutate({ startDate: startDate || null, dueDate: dueDate || null, dueTime: null }); }}>
                  Clear
                </button>
              )}
            </div>
            {!dueDate && (
              <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                Set a due date first — the due time only applies when there is a deadline.
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--card-border)" }} className="pt-4">
            <div className="text-sm font-medium mb-2">Reminders</div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={remindersMuted}
                  disabled={!dueDate && !startDate}
                  onChange={(e) => { setRemindersMuted(e.target.checked); reminders.mutate({ muted: e.target.checked }); }}
                />
                Mute reminders for this task
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={remindOnStart}
                  disabled={!startDate || remindersMuted}
                  onChange={(e) => { setRemindOnStart(e.target.checked); reminders.mutate({ remindOnStart: e.target.checked }); }}
                />
                Remind me when the start date arrives
              </label>
              <div>
                <label className="block text-sm mb-1">Lead time override (minutes)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    className="input"
                    placeholder="Use board default"
                    aria-label="Lead time override"
                    value={leadInput}
                    disabled={remindersMuted || (!dueDate && !startDate)}
                    title={remindersMuted || (!dueDate && !startDate) ? "Give this task a date, and unmute it, to set a lead time" : undefined}
                    onChange={(e) => setLeadInput(e.target.value)}
                    onBlur={() => {
                      const raw = leadInput.trim();
                      const next = raw === "" ? null : Math.max(0, Math.floor(Number(raw)));
                      if (raw !== "" && !Number.isFinite(next as number)) return;
                      const current = task.remindLeadMinutes ?? null;
                      if (next === current) return;
                      reminders.mutate({ leadMinutes: next });
                    }}
                  />
                  {task.remindLeadMinutes !== null && task.remindLeadMinutes !== undefined && (
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      onClick={() => { setLeadInput(""); reminders.mutate({ leadMinutes: null }); }}
                    >
                      Use default
                    </button>
                  )}
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  {task.remindLeadMinutes === null || task.remindLeadMinutes === undefined
                    ? "Using the board default from Notification settings."
                    : `Overridden for this task (board default ignored).`}
                </div>
              </div>
              {reminders.isError && (
                <div className="text-xs" style={{ color: "var(--danger)" }}>
                  {(reminders.error as Error)?.message ?? "Could not update reminders"}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Priority</label>
              <select className="input" value={priority} onChange={(e) => { setPriority(Number(e.target.value)); update.mutate({ priority: Number(e.target.value) }); }}>
                <option value={1}>1 — Urgent</option>
                <option value={2}>2 — High</option>
                <option value={3}>3 — Medium</option>
                <option value={4}>4 — Low</option>
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">Progress ({progress}%)</label>
              <input
                type="range" min={0} max={100} value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
                onMouseUp={() => update.mutate({ progress })}
                onTouchEnd={() => update.mutate({ progress })}
                className="w-full"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm">Checklist ({doneCount}/{subtasks.length})</label>
            </div>
            <div className="space-y-1">
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={s.isDone} onChange={(e) => toggleSubtask.mutate({ subId: s.id, isDone: e.target.checked })} />
                  <span className="text-sm" style={s.isDone ? { textDecoration: "line-through", color: "var(--muted)" } : {}}>{s.title}</span>
                </div>
              ))}
            </div>
            <input
              className="input mt-2"
              placeholder="Add a subtask…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.currentTarget.value.trim()) {
                  addSubtask.mutate(e.currentTarget.value.trim());
                  e.currentTarget.value = "";
                }
              }}
            />
          </div>

          <div className="pt-4" style={{ borderTop: "1px solid var(--card-border)" }}>
            <button
              className="btn btn-danger w-full justify-center"
              onClick={() => setConfirmDelete(true)}
            >
              Delete task
            </button>
          </div>

          <ConfirmDialog
            open={confirmDelete}
            title="Delete this task?"
            message="This cannot be undone."
            confirmLabel="Delete task"
            danger
            busy={remove.isPending}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => remove.mutate()}
          />
        </div>
      </div>
    </div>
  );
}
