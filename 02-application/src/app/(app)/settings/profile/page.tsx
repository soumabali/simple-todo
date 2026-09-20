"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { TIMEZONES } from "@/lib/timezones";

/**
 * Profile settings (PRD F-9 / U8).
 *
 * Name and timezone only — email and role stay admin-managed (F-8.3).
 * Timezone is not cosmetic: every reminder boundary (default time, quiet hours,
 * "due today") is computed in it, so changing it shifts future notifications.
 */

type Profile = {
  id: string;
  name: string;
  email: string;
  role: string;
  timezone: string;
  createdAt: string;
};

export default function ProfilePage() {
  const qc = useQueryClient();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<{ profile: Profile }>("/api/settings/profile"),
  });

  const profile = data?.profile;

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  // Hydrate the form once the profile arrives, without clobbering in-progress
  // edits on later refetches.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (profile && !hydrated) {
      setName(profile.name ?? "");
      setTimezone(profile.timezone ?? "Asia/Makassar");
      setHydrated(true);
    }
  }, [profile, hydrated]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ profile: Profile }>("/api/settings/profile", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      setErr("");
      setMsg("Profile saved.");
      qc.setQueryData(["profile"], res);
      qc.invalidateQueries({ queryKey: ["profile"] });
      // The header renders the name from the server layout — refresh so the
      // new name appears without a manual reload.
      router.refresh();
    },
    onError: (e: unknown) => {
      setMsg("");
      setErr(e instanceof Error ? e.message : "Could not save profile");
    },
  });

  const dirty = !!profile && (name !== (profile.name ?? "") || timezone !== profile.timezone);

  // Offer the browser's own zone when it differs — a wrong zone is the most
  // common cause of "my reminder fired at the wrong hour".
  const localTz =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const suggestLocal =
    !!profile && !!localTz && localTz !== profile.timezone && localTz !== timezone;

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto" style={{ color: "var(--muted)" }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Profile</h1>
      <p className="text-sm mb-6" style={{ color: "var(--muted)" }}>
        Your display name and the timezone used for reminders.
      </p>

      <div className="card p-5 space-y-5">
        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="profile-name">
            Display name
          </label>
          <input
            id="profile-name"
            className="input w-full"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setMsg("");
            }}
            maxLength={80}
            placeholder="Your name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" htmlFor="profile-tz">
            Timezone
          </label>
          <select
            id="profile-tz"
            className="input w-full"
            value={timezone}
            onChange={(e) => {
              setTimezone(e.target.value);
              setMsg("");
            }}
          >
            {/* Keep an unrecognised stored value selectable instead of silently
                rewriting the user's setting. */}
            {timezone && !TIMEZONES.some((t) => t.value === timezone) && (
              <option value={timezone}>{timezone}</option>
            )}
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="text-xs mt-1.5" style={{ color: "var(--muted)" }}>
            Reminders, quiet hours and &ldquo;due today&rdquo; are all calculated in this
            timezone.
          </p>
          {suggestLocal && (
            <p className="text-xs mt-1.5" style={{ color: "var(--accent)" }}>
              Your browser reports <strong>{localTz}</strong>.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setTimezone(localTz);
                  setMsg("");
                }}
              >
                Use it
              </button>
            </p>
          )}
        </div>

        <div className="pt-1 flex items-center gap-3">
          <button
            className="btn btn-primary"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ name, timezone })}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
          {dirty && !save.isPending && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setName(profile?.name ?? "");
                setTimezone(profile?.timezone ?? "");
                setMsg("");
                setErr("");
              }}
            >
              Reset
            </button>
          )}
          {msg && (
            <span className="text-sm" style={{ color: "var(--accent)" }}>
              {msg}
            </span>
          )}
          {err && (
            <span className="text-sm" style={{ color: "var(--danger)" }}>
              {err}
            </span>
          )}
        </div>
      </div>

      <div className="card p-5 mt-4">
        <h2 className="text-sm font-bold mb-3">Account</h2>
        <dl className="text-sm space-y-2">
          <div className="flex justify-between gap-4">
            <dt style={{ color: "var(--muted)" }}>Email</dt>
            <dd>{profile?.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt style={{ color: "var(--muted)" }}>Role</dt>
            <dd>{profile?.role}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt style={{ color: "var(--muted)" }}>Member since</dt>
            <dd>
              {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : "—"}
            </dd>
          </div>
        </dl>
        <p className="text-xs mt-3" style={{ color: "var(--muted)" }}>
          Email and role are managed by an administrator.
        </p>
        <div className="flex flex-wrap gap-2 mt-4 pt-4" style={{ borderTop: "1px solid var(--card-border)" }}>
          <Link href="/change-password" className="btn btn-ghost text-sm">
            Change password
          </Link>
          <Link href="/settings/notifications" className="btn btn-ghost text-sm">
            Notification settings
          </Link>
          <Link href="/settings/api-keys" className="btn btn-ghost text-sm">
            API keys
          </Link>
        </div>
      </div>
    </div>
  );
}
