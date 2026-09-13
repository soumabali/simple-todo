"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Notification = {
  id: number;
  kind: string;
  status: string;
  scheduledFor: string;
  sentAt: string | null;
  readAt: string | null;
  taskTitle: string;
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ notifications: Notification[] }>("/api/notifications"),
  });

  const markAll = useMutation({
    mutationFn: () => api("/api/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const kindLabel: Record<string, string> = {
    start_soon: "Time to start",
    due_soon: "Due soon",
    due_today: "Due today",
    overdue: "Overdue",
  };

  const items = data?.notifications ?? [];
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">
          Notifications
          {unread > 0 && (
            <span className="ml-2 text-sm font-medium" style={{ color: "var(--accent)" }}>
              {unread} unread
            </span>
          )}
        </h1>
        <button className="btn btn-ghost text-sm" onClick={() => markAll.mutate()} disabled={unread === 0}>
          Mark all as read
        </button>
      </div>

      {isLoading ? (
        <div style={{ color: "var(--muted)" }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No notifications yet. Reminders you receive will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n) => (
            <div key={n.id} className="card p-4" style={!n.readAt ? { borderLeft: "3px solid var(--accent)" } : {}}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>
                  {kindLabel[n.kind] ?? n.kind}
                </span>
                {n.sentAt && (
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {new Date(n.sentAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="text-sm font-medium mt-1">{n.taskTitle}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
