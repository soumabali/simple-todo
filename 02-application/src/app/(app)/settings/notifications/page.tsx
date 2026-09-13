"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

type Settings = {
  userId: string;
  pushEnabled?: boolean;
  defaultTime?: string;
  leadMinutesStart?: number;
  leadMinutesDue?: number;
  notifyDueToday?: boolean;
  notifyOverdue?: boolean;
  quietStart?: string;
  quietEnd?: string;
};

type Subscription = {
  id: string;
  endpoint: string;
  deviceLabel: string | null;
  isStandalone: boolean;
  createdAt: string;
};

export default function NotificationSettingsPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");

  const { data } = useQuery({
    queryKey: ["notification-settings"],
    queryFn: () => api<{ settings: Settings }>("/api/settings/notifications"),
  });

  const { data: subs } = useQuery({
    queryKey: ["push-subscriptions"],
    queryFn: () => api<{ subscriptions: Subscription[] }>("/api/push/subscribe"),
  });

  const settings: Settings = data?.settings ?? { userId: "" };

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api("/api/settings/notifications", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-settings"] });
      setMsg("Saved ✓");
      setTimeout(() => setMsg(""), 2000);
    },
  });

  const forget = useMutation({
    mutationFn: (endpoint: string) =>
      api("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push-subscriptions"] }),
  });

  const testPush = useMutation({
    mutationFn: (endpoint: string) =>
      api("/api/push/test", { method: "POST", body: JSON.stringify({ endpoint }) }),
  });

  function set(k: string, v: unknown) {
    save.mutate({ [k]: v });
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Notification settings</h1>

      {msg && <div className="text-sm mb-3" style={{ color: "var(--success)" }}>{msg}</div>}

      <div className="card p-6 space-y-4">
        <SettingToggle label="Enable push reminders" checked={settings.pushEnabled ?? true} onChange={(v) => set("pushEnabled", v)} />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Default delivery time</label>
            <input type="time" className="input" value={settings.defaultTime ?? "08:00"} onChange={(e) => set("defaultTime", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">Start reminder lead (min)</label>
            <input type="number" className="input" value={settings.leadMinutesStart ?? 0} onChange={(e) => set("leadMinutesStart", Number(e.target.value))} />
          </div>
          <div>
            <label className="block text-sm mb-1">Due reminder lead (min)</label>
            <input type="number" className="input" value={settings.leadMinutesDue ?? 1440} onChange={(e) => set("leadMinutesDue", Number(e.target.value))} />
          </div>
        </div>

        <SettingToggle label="Notify me on the due date" checked={settings.notifyDueToday ?? true} onChange={(v) => set("notifyDueToday", v)} />
        <SettingToggle label="Notify me when a task is overdue" checked={settings.notifyOverdue ?? true} onChange={(v) => set("notifyOverdue", v)} />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Quiet hours start</label>
            <input type="time" className="input" value={settings.quietStart ?? "22:00"} onChange={(e) => set("quietStart", e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">Quiet hours end</label>
            <input type="time" className="input" value={settings.quietEnd ?? "07:00"} onChange={(e) => set("quietEnd", e.target.value)} />
          </div>
        </div>
      </div>

      <h2 className="text-lg font-semibold mt-8 mb-3">Registered devices</h2>
      <div className="space-y-2">
        {(subs?.subscriptions ?? []).length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No devices registered yet. Enable push notifications on a device to register it.
          </p>
        ) : (
          subs?.subscriptions.map((s) => (
            <div key={s.id} className="card p-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{s.deviceLabel ?? "Unknown device"}</div>
                <div className="text-xs" style={{ color: "var(--muted)" }}>{s.isStandalone ? "Installed PWA" : "Browser tab"}</div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-ghost text-xs" onClick={() => testPush.mutate(s.endpoint)}>Test</button>
                <button className="btn btn-ghost text-xs" onClick={() => forget.mutate(s.endpoint)}>Forget</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SettingToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-sm">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
