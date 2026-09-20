"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [generated, setGenerated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // U10: deletion is confirmed through the shared ConfirmDialog, not native confirm().
  const [pendingDelete, setPendingDelete] = useState<User | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", q, role, status, page],
    queryFn: () =>
      api<{ users: User[]; total: number; page: number; pageSize: number }>(
        `/api/admin/users?q=${encodeURIComponent(q)}&role=${role}&status=${status}&page=${page}`
      ),
  });

  const createUser = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/api/admin/users", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setShowForm(false);
      setNewName("");
      setNewEmail("");
      setGenerated(res.password);
    },
  });

  const toggleBan = useMutation({
    mutationFn: (v: { id: string; banned: boolean }) =>
      api(`/api/admin/users/${v.id}`, { method: "PATCH", body: JSON.stringify({ banned: v.banned }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const setUserRole = useMutation({
    mutationFn: (v: { id: string; role: string }) =>
      api(`/api/admin/users/${v.id}`, { method: "PATCH", body: JSON.stringify({ role: v.role }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const resetPassword = useMutation({
    mutationFn: (id: string) => api(`/api/admin/users/${id}/reset-password`, { method: "POST" }),
    onSuccess: (res: any) => setGenerated(res.password),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => api(`/api/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / 25));

  async function copyGenerated() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
    } catch {
      // Fallback for browsers that block the async Clipboard API without
      // a secure context or user activation.
      const ta = document.createElement("textarea");
      ta.value = generated;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Users</h1>
        <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>+ Add user</button>
      </div>

      {generated && (
        <div className="card p-4 mb-4" style={{ borderColor: "var(--success)" }}>
          <div className="text-sm font-medium mb-1">Temporary password (shown once)</div>
          <code className="text-lg font-mono">{generated}</code>
          <button className="btn btn-ghost text-xs ml-2" onClick={copyGenerated}>
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      )}

      {showForm && (
        <div className="card p-4 mb-4 flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-sm mb-1">Name</label>
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="block text-sm mb-1">Email</label>
            <input className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">Role</label>
            <select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <button className="btn btn-primary" disabled={!newName.trim() || !newEmail.trim() || createUser.isPending} onClick={() => createUser.mutate({ name: newName, email: newEmail, role: newRole })}>
            Create
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input className="input" placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All status</option>
          <option value="active">Active</option>
          <option value="deactivated">Deactivated</option>
        </select>
      </div>

      {isLoading ? (
        <div style={{ color: "var(--muted)" }}>Loading…</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Role</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Last login</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.users.map((u) => (
                <tr key={u.id} style={{ borderBottom: "1px solid var(--card-border)" }}>
                  <td className="p-3 font-medium">{u.name}</td>
                  <td className="p-3">{u.email}</td>
                  <td className="p-3">
                    <select className="input w-auto py-1" value={u.role} onChange={(e) => setUserRole.mutate({ id: u.id, role: e.target.value })}>
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="p-3">
                    <span className={`chip ${u.banned ? "chip-rose" : "chip-emerald"}`}>{u.banned ? "Deactivated" : "Active"}</span>
                  </td>
                  <td className="p-3">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</td>
                  <td className="p-3 text-right">
                    <button className="btn btn-ghost text-xs" onClick={() => resetPassword.mutate(u.id)}>Reset pw</button>
                    <button className="btn btn-ghost text-xs" onClick={() => toggleBan.mutate({ id: u.id, banned: !u.banned })}>
                      {u.banned ? "Activate" : "Deactivate"}
                    </button>
                    <button className="btn btn-ghost text-xs" style={{ color: "var(--danger)" }} onClick={() => setPendingDelete(u)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <button className="btn btn-ghost text-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
        <span className="text-sm" style={{ color: "var(--muted)" }}>Page {page} of {totalPages}</span>
        <button className="btn btn-ghost text-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete user"
        message={
          pendingDelete
            ? `Delete ${pendingDelete.email}? This permanently removes the account and everything owned by it (boards, tasks, API keys).`
            : undefined
        }
        confirmLabel="Delete user"
        danger
        busy={deleteUser.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteUser.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) });
        }}
      />
    </div>
  );
}
