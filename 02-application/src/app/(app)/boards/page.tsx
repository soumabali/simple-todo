"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

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
                    onClick={() => setColor(c)}
                    className="w-6 h-6 rounded-full"
                    style={{
                      background: `var(--${c === "indigo" ? "accent" : c === "emerald" ? "success" : c === "amber" ? "warning" : c === "rose" ? "danger" : c})`,
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
            <Link key={b.id} href={`/boards/${b.id}`} className="card card-hover p-4 block">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{
                    background: `var(--${
                      b.color === "indigo" ? "accent" : b.color === "emerald" ? "success" : b.color === "amber" ? "warning" : b.color === "rose" ? "danger" : b.color
                    })`,
                  }}
                />
                <h2 className="font-semibold">{b.name}</h2>
              </div>
              {b.description && (
                <p className="text-sm mb-3 truncate" style={{ color: "var(--muted)" }}>
                  {b.description}
                </p>
              )}
              <div className="flex gap-2 text-xs" style={{ color: "var(--muted)" }}>
                <span>{b.taskCount} tasks</span>
                {b.overdue > 0 && <span style={{ color: "var(--danger)" }}>{b.overdue} overdue</span>}
                {b.dueThisWeek > 0 && <span style={{ color: "var(--warning)" }}>{b.dueThisWeek} due this week</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
