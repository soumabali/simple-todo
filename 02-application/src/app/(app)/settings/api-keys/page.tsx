"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * API key management (PRD §F-11).
 *
 * Keys authenticate the public REST API (/api/v1/*) so external systems —
 * scripts, another app, or an agent such as Hermes — can work with this user's
 * todos. A key is bound to its owner: it can only ever reach that user's data.
 */

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  active: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type NewKey = { id: string; name: string; prefix: string; scopes: string[] };

const BASE = typeof window === "undefined" ? "" : window.location.origin;

/** Endpoint reference shown to the user — copy-paste ready for any integrator. */
const ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: "GET", path: "/api/v1/me", desc: "Verify the key; returns the owner's profile and timezone" },
  { method: "GET", path: "/api/v1/boards", desc: "All boards with their columns (statuses) and task counts" },
  { method: "GET", path: "/api/v1/todos", desc: "List todos — filters: boardId, statusId, state, due, within, q, limit" },
  { method: "POST", path: "/api/v1/todos", desc: "Create a todo (boardId + title required)" },
  { method: "GET", path: "/api/v1/todos/:id", desc: "Read a single todo" },
  { method: "PATCH", path: "/api/v1/todos/:id", desc: "Update fields, change status, complete/reopen a todo" },
  { method: "DELETE", path: "/api/v1/todos/:id", desc: "Delete a todo" },
  { method: "GET", path: "/api/v1/todos/expiring", desc: "Overdue / due-today / expiring-soon buckets" },
  { method: "GET", path: "/api/v1/reminders", desc: "Reminder agenda — view=upcoming|inbox|kinds" },
  { method: "POST", path: "/api/v1/reminders", desc: "Mark reminders as read ({ ids } or { all: true })" },
];

export default function ApiKeysPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [write, setWrite] = useState(true);
  const [expiresInDays, setExpiresInDays] = useState<string>("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [error, setError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api<{ apiKeys: ApiKey[] }>("/api/api-keys"),
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ apiKey: NewKey; key: string }>("/api/api-keys", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          scopes: write ? ["read", "write"] : ["read"],
          expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
        }),
      }),
    onSuccess: (res) => {
      setFresh(res.key);
      setName("");
      setExpiresInDays("");
      setError("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/api-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => {
      setRevoking(null);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const keys = data?.apiKeys ?? [];

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Could not copy — select the text manually.");
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">API keys</h1>
      <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
        Use a key to read and manage <strong>your own</strong> todos from another system — a script, an
        app, or an assistant such as Hermes. A key can only ever access the data of the account that
        created it.
      </p>

      {error && (
        <div className="card p-3 mb-4 text-sm" style={{ color: "var(--danger, #dc2626)" }}>
          {error}
        </div>
      )}

      {/* A newly minted key — shown exactly once. */}
      {fresh && (
        <div className="card p-5 mb-6" style={{ borderColor: "var(--success)" }}>
          <h2 className="text-base font-bold mb-1">Your new API key</h2>
          <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>
            Copy it now — for security it is stored hashed and <strong>cannot be shown again</strong>.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <code
              className="flex-1 text-xs p-3 rounded-lg overflow-x-auto whitespace-nowrap"
              style={{ background: "var(--bg)", border: "1px solid var(--card-border)" }}
            >
              {fresh}
            </code>
            <button className="btn btn-primary text-sm" onClick={() => copy(fresh, "key")}>
              {copied === "key" ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost text-sm" onClick={() => setFresh(null)}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create */}
      <div className="card p-5 mb-6">
        <h2 className="text-base font-bold mb-4">Create a key</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-sm mb-1">Label</label>
            <input
              className="input"
              placeholder="e.g. Hermes agent, n8n workflow"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Permissions</label>
            <select className="input" value={write ? "rw" : "r"} onChange={(e) => setWrite(e.target.value === "rw")}>
              <option value="rw">Read & write — full CRUD</option>
              <option value="r">Read only — list and inspect</option>
            </select>
          </div>
          <div>
            <label className="block text-sm mb-1">Expires in (days, optional)</label>
            <input
              className="input"
              type="number"
              min={1}
              max={3650}
              placeholder="never"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
            />
          </div>
        </div>
        <button
          className="btn btn-primary mt-4"
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? "Generating…" : "Generate key"}
        </button>
      </div>

      {/* Existing keys */}
      <div className="card p-5 mb-6">
        <h2 className="text-base font-bold mb-4">Your keys</h2>
        {isLoading ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>No API keys yet.</p>
        ) : (
          <div className="space-y-3">
            {keys.map((k) => (
              <div
                key={k.id}
                className="p-3 rounded-lg flex flex-wrap items-center gap-3 text-sm"
                style={{ border: "1px solid var(--card-border)" }}
              >
                <div className="flex-1 min-w-[12rem]">
                  <div className="font-medium">
                    {k.name}{" "}
                    {!k.active && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--bg)", color: "var(--muted)" }}>
                        {k.revokedAt ? "revoked" : "expired"}
                      </span>
                    )}
                  </div>
                  <div className="text-xs" style={{ color: "var(--muted)" }}>
                    <code>{k.prefix}…</code> · {k.scopes.join(", ")} ·{" "}
                    {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleString()}` : "never used"}
                    {k.expiresAt ? ` · expires ${new Date(k.expiresAt).toLocaleDateString()}` : ""}
                  </div>
                </div>
                {k.active && (
                  <button className="btn btn-ghost text-sm" onClick={() => setRevoking(k)}>
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Endpoint reference */}
      <div className="card p-5">
        <h2 className="text-base font-bold mb-1">Endpoint reference</h2>
        <p className="text-sm mb-3" style={{ color: "var(--muted)" }}>
          Base URL <code>{BASE}/api/v1</code> — send the key as{" "}
          <code>Authorization: Bearer &lt;key&gt;</code> or <code>x-api-key: &lt;key&gt;</code>.
        </p>
        <div className="space-y-2">
          {ENDPOINTS.map((e) => (
            <div key={e.method + e.path} className="text-xs flex flex-wrap gap-2 items-baseline">
              <span
                className="px-2 py-0.5 rounded font-mono font-bold"
                style={{ background: "var(--bg)", color: "var(--accent)", minWidth: "3.5rem", textAlign: "center" }}
              >
                {e.method}
              </span>
              <code className="font-mono">{e.path}</code>
              <span style={{ color: "var(--muted)" }}>— {e.desc}</span>
            </div>
          ))}
        </div>
        <p className="text-xs mt-4" style={{ color: "var(--muted)" }}>
          Limits: 120 requests per minute per key, 500 todos per response.
        </p>
      </div>

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this API key?"
        message={`"${revoking?.name}" will stop working immediately. Integrations using it will receive 401 responses. This cannot be undone.`}
        confirmLabel="Revoke"
        danger
        busy={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}
