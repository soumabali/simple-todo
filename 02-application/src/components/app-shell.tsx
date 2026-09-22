"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

type User = { id: string; name: string; email: string; role?: string };

export function AppShell({ children, initialUser }: { children: React.ReactNode; initialUser: User }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  const isAdmin = initialUser?.role === "admin";

  const navItems = [
    { href: "/boards", label: "Boards", active: pathname.startsWith("/boards") },
    { href: "/notifications", label: "Notifications", active: pathname.startsWith("/notifications") },
    { href: "/settings/api-keys", label: "API", active: pathname.startsWith("/settings/api-keys") },
  ];
  if (isAdmin) {
    navItems.push({ href: "/admin/users", label: "Admin", active: pathname.startsWith("/admin") });
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header
        className="sticky top-0 z-40 flex items-center gap-4 px-4 py-3"
        style={{ background: "var(--card)", borderBottom: "1px solid var(--card-border)" }}
      >
        <Link
          href="/boards"
          className="flex items-center gap-2 shrink-0"
          aria-label="FlowBoard — ke Boards"
        >
          {/* Ikon inline, bukan <img src="/icon.svg">: tidak ada permintaan
              tambahan, dan warnanya bisa ikut tema. Bentuknya sama dengan
              public/icon.svg (sumber favicon) supaya identitasnya konsisten. */}
          <svg
            width="26"
            height="26"
            viewBox="0 0 512 512"
            aria-hidden="true"
            className="shrink-0"
          >
            <defs>
              <linearGradient id="fb-logo-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#818cf8" />
                <stop offset="0.45" stopColor="#6366f1" />
                <stop offset="1" stopColor="#4338ca" />
              </linearGradient>
            </defs>
            <rect width="512" height="512" rx="112" fill="url(#fb-logo-bg)" />
            <rect x="96" y="150" width="96" height="212" rx="26" fill="#fff" fillOpacity="0.95" />
            <rect x="208" y="118" width="96" height="244" rx="26" fill="#fff" fillOpacity="0.95" />
            <rect x="320" y="176" width="96" height="186" rx="26" fill="#fff" fillOpacity="0.95" />
            <g stroke="#4f46e5" strokeOpacity="0.55" strokeWidth="13" strokeLinecap="round">
              <line x1="118" y1="196" x2="170" y2="196" />
              <line x1="118" y1="228" x2="150" y2="228" />
              <line x1="230" y1="164" x2="282" y2="164" />
              <line x1="230" y1="196" x2="258" y2="196" />
              <line x1="342" y1="222" x2="394" y2="222" />
            </g>
            <circle cx="342" cy="200" r="17" fill="#22c55e" />
            <path
              d="M334 200l6 6 11-12"
              fill="none"
              stroke="#fff"
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-bold text-lg" style={{ color: "var(--accent)" }}>
            FlowBoard
          </span>
        </Link>

        <nav className="flex items-center gap-1 flex-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-1.5 text-sm rounded-lg"
              style={
                item.active
                  ? { background: "var(--accent)", color: "#fff" }
                  : { color: "var(--muted)" }
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/settings/notifications"
            className="text-sm px-2 py-1.5 rounded-lg"
            style={{ color: "var(--muted)" }}
            title="Notification settings"
          >
            ⚙️
          </Link>
          <Link
            href="/settings/profile"
            className="text-sm px-2 py-1.5 rounded-lg hidden sm:inline"
            style={{ color: "var(--muted)" }}
            title="Profile — display name and timezone"
          >
            {initialUser?.name ?? initialUser?.email}
          </Link>
          <button onClick={signOut} className="btn btn-ghost text-sm">
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
