"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Admin landing page.
 *
 * `/admin` previously had no page at all — only `/admin/users` and
 * `/admin/logs` existed. Because the layout's admin gate matches `/admin` and
 * `/admin/*`, a signed-in admin landed on a bare Next 404 here, which looks
 * identical to the permission denial that non-admins get. There was no way to
 * tell "you may not" apart from "it was never built".
 *
 * Guarding is done by the `(app)` layout (non-admins get 404 from
 * `decideShell`); this component only runs for admins and stays presentational.
 */

type UsersResponse = {
  total: number;
  page: number;
  pageSize: number;
};

type LogsResponse = {
  logs: { id: number; action: string; createdAt: string }[];
};

const CARDS = [
  {
    href: "/admin/users",
    title: "Users",
    body: "Create, disable and re-role accounts. Reset passwords.",
  },
  {
    href: "/admin/logs",
    title: "Activity log",
    body: "Every mutating action, with actor and target entity.",
  },
];

export default function AdminPage() {
  const users = useQuery({
    queryKey: ["admin-users-summary"],
    queryFn: () => api<UsersResponse>("/api/admin/users?page=1"),
  });

  const logs = useQuery({
    queryKey: ["admin-logs-summary"],
    queryFn: () => api<LogsResponse>("/api/admin/logs"),
  });

  const latest = logs.data?.logs?.[0];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Admin</h1>
      <p className="mb-6 text-sm" style={{ color: "var(--muted)" }}>
        Instance administration.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        <div className="card p-4">
          <div className="text-sm" style={{ color: "var(--muted)" }}>Accounts</div>
          <div className="text-3xl font-bold mt-1">
            {users.isLoading ? "…" : users.isError ? "—" : users.data?.total ?? 0}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-sm" style={{ color: "var(--muted)" }}>Last activity</div>
          <div className="text-lg font-semibold mt-1 break-words">
            {logs.isLoading
              ? "…"
              : logs.isError
                ? "—"
                : latest
                  ? `${latest.action} · ${new Date(latest.createdAt).toLocaleString()}`
                  : "No activity yet."}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className="card p-4 block hover:opacity-90">
            <div className="font-semibold">{c.title}</div>
            <div className="text-sm mt-1" style={{ color: "var(--muted)" }}>{c.body}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
