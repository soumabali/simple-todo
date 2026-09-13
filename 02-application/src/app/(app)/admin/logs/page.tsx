"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Log = {
  id: number;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
};

export default function AdminLogsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-logs"],
    queryFn: () => api<{ logs: Log[] }>("/api/admin/logs"),
  });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Activity log</h1>
      {isLoading ? (
        <div style={{ color: "var(--muted)" }}>Loading…</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--card-border)" }}>
                <th className="text-left p-3">Time</th>
                <th className="text-left p-3">Actor</th>
                <th className="text-left p-3">Action</th>
                <th className="text-left p-3">Entity</th>
              </tr>
            </thead>
            <tbody>
              {data?.logs.map((l) => (
                <tr key={l.id} style={{ borderBottom: "1px solid var(--card-border)" }}>
                  <td className="p-3">{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="p-3">{l.actorName ?? l.actorEmail ?? "—"}</td>
                  <td className="p-3 font-mono text-xs">{l.action}</td>
                  <td className="p-3">{l.entityType}:{l.entityId ?? ""}</td>
                </tr>
              ))}
              {data?.logs.length === 0 && (
                <tr><td colSpan={4} className="p-6 text-center" style={{ color: "var(--muted)" }}>No activity yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
