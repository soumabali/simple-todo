"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Board = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  isArchived: boolean;
  taskCount: number;
  overdue: number;
  dueThisWeek: number;
};

const COLORS = ["indigo", "emerald", "amber", "rose", "sky", "violet", "slate"];

export default function BoardsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("indigo");
  const [showArchived, setShowArchived] = useState(false);
  const [editBoard, setEditBoard] = useState<Board | null>(null);
  const [deleteBoard, setDeleteBoard] = useState<Board | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["boards"],
    queryFn: () => api<{ boards: Board[] }>("/api/boards"),
  });

  const createBoard = useMutation({
    mutationFn: (body: { name: string; color: string }) =>
      api("/api/boards", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boards"] });
      setShowForm(false);
      setName("");
    },
  });

  const updateBoard = useMutation({
    mutationFn: (body: { id: string } & Record<string, unknown>) =>
      api(`/api/boards/${body.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boards"] });
      setEditBoard(null);
    },
  });

  const archiveBoard = useMutation({
    mutationFn: (b: Board) =>
      api(`/api/boards/${b.id}`, { method: "PATCH", body: JSON.stringify({ isArchived: !b.isArchived }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["boards"] }),
  });

  const removeBoard = useMutation({
    mutationFn: (b: Board) => api(`/api/boards/${b.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boards"] });
      setDeleteBoard(null);
      setConfirmText("");
    },
  });

  const boards = (data?.boards ?? []).filter((b) => (showArchived ? true : !b.isArchived));

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Boards</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Archived
          </label>
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            + New board
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card p-4 mb-6">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm mb-1">Board name</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Work, Home, Side project"
                maxLength={60}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Color</label>
              <div className="flex gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    aria-label={`Color ${c}`}
                    onClick={() => setColor(c)}
                    className="w-6 h-6 rounded-full"
                    style={{
                      background: `var(--${c})`,
                      outline: color === c ? "2px solid var(--accent)" : "none",
                    }}
                  />
                ))}
              </div>
            </div>
            <button
              className="btn btn-primary"
              disabled={!name.trim() || createBoard.isPending}
              onClick={() => createBoard.mutate({ name, color })}
            >
              Create
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ color: "var(--muted)" }}>Loading boards…</div>
      ) : boards.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-lg font-medium mb-2">No boards yet</p>
          <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
            Create your first board to get started.
          </p>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            Create your first board
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {boards.map((b) => (
            <div key={b.id} className="card card-hover p-4 relative">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/boards/${b.id}`} className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: `var(--${b.color})` }} />
                    <h2 className="font-semibold truncate">{b.name}</h2>
                    {b.isArchived && <span className="chip chip-grey shrink-0">Archived</span>}
                  </div>
                  {b.description && (
                    <p className="text-sm mb-3 truncate" style={{ color: "var(--muted)" }}>
                      {b.description}
                    </p>
                  )}
                  <div className="flex gap-2 text-xs flex-wrap" style={{ color: "var(--muted)" }}>
                    <span>{b.taskCount} tasks</span>
                    {b.overdue > 0 && <span style={{ color: "var(--danger)" }}>{b.overdue} overdue</span>}
                    {b.dueThisWeek > 0 && <span style={{ color: "var(--warning)" }}>{b.dueThisWeek} due this week</span>}
                  </div>
                </Link>

                <BoardMenu
                  board={b}
                  onEdit={() => setEditBoard(b)}
                  onArchive={() => archiveBoard.mutate(b)}
                  onDelete={() => { setDeleteBoard(b); setConfirmText(""); }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit board (U3) */}
      {editBoard && (
        <EditBoardDialog
          board={editBoard}
          busy={updateBoard.isPending}
          onCancel={() => setEditBoard(null)}
          onSave={(patch) => updateBoard.mutate({ id: editBoard.id, ...patch })}
        />
      )}

      {/* Delete board with type-to-confirm (U3/U10) */}
      <ConfirmDialog
        open={!!deleteBoard}
        title={`Delete "${deleteBoard?.name ?? ""}"?`}
        message="This permanently deletes the board and everything inside it. This cannot be undone."
        confirmLabel="Delete board"
        danger
        busy={removeBoard.isPending}
        confirmDisabled={!deleteBoard || confirmText.trim() !== deleteBoard.name}
        onCancel={() => { setDeleteBoard(null); setConfirmText(""); }}
        onConfirm={() => deleteBoard && removeBoard.mutate(deleteBoard)}
      >
        <label className="block text-sm mb-1">
          Type <span className="font-mono font-semibold">{deleteBoard?.name}</span> to confirm
        </label>
        <input
          className="input"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={deleteBoard?.name}
        />
        {deleteBoard && confirmText.trim() !== deleteBoard.name && confirmText.length > 0 && (
          <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>
            Name does not match
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

function BoardMenu({
  board,
  onEdit,
  onArchive,
  onDelete,
}: {
  board: Board;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        className="btn btn-ghost text-sm px-2 py-1"
        aria-label="Board options"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 card p-1 w-40 text-sm" style={{ boxShadow: "var(--shadow-card)" }}>
            <button className="w-full text-left px-3 py-1.5 rounded hover:bg-black/5" onClick={() => { onEdit(); setOpen(false); }}>
              Edit board
            </button>
            <button className="w-full text-left px-3 py-1.5 rounded hover:bg-black/5" onClick={() => { onArchive(); setOpen(false); }}>
              {board.isArchived ? "Unarchive" : "Archive"}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 rounded hover:bg-black/5"
              style={{ color: "var(--danger)" }}
              onClick={() => { onDelete(); setOpen(false); }}
            >
              Delete board
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function EditBoardDialog({
  board,
  busy,
  onCancel,
  onSave,
}: {
  board: Board;
  busy: boolean;
  onCancel: () => void;
  onSave: (patch: { name: string; description: string | null; color: string }) => void;
}) {
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description ?? "");
  const [color, setColor] = useState(board.color);

  // Close on Escape (matches ConfirmDialog).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Edit board"
    >
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold mb-4">Edit board</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1">Name</label>
            <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="block text-sm mb-1">Description</label>
            <textarea
              className="input"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Color</label>
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className="w-6 h-6 rounded-full"
                  style={{ background: `var(--${c})`, outline: color === c ? "2px solid var(--accent)" : "none" }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!name.trim() || busy}
            onClick={() => onSave({ name: name.trim(), description: description.trim() || null, color })}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
