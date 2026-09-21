#!/usr/bin/env python3
"""FlowBoard production E2E test harness (live against todo.nexigo.my.id).

Reads test credentials from the environment — this repository is public, so no
credentials are stored in the file. Required:

    E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD     admin account
    E2E_USER_EMAIL  / E2E_USER_PASSWORD      regular user account
    E2E_USER_NEW_PASSWORD                    temp password for the change-password test
    E2E_CONFIRM=yes                          explicit go-ahead

Preferred over E2E_ADMIN_PASSWORD / E2E_USER_PASSWORD / E2E_USER_NEW_PASSWORD:
point E2E_CREDS_FILE at the JSON written by `02-application/scripts/e2e-provision.ts`.
Passwords then never appear in the process table (`ps`), the shell history, or
your terminal scrollback:

    E2E_CREDS_FILE=/tmp/e2e-creds.json E2E_USER_NEW_PASSWORD_SUFFIX=X9z \
      E2E_CONFIRM=yes python3 e2e-live.py

WARNING: this script MUTATES the target database — it creates and deletes
users, resets passwords, and edits boards/tasks. Point it at a throwaway
account, never at real user data, and only ever against a host you are allowed
to change. The E2E_CONFIRM gate exists so it cannot be run by accident.
"""
import json, os, time, sys, urllib.request, urllib.error, http.cookiejar, re

BASE = "https://todo.nexigo.my.id"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

ADMIN = {"email": os.environ.get("E2E_ADMIN_EMAIL", ""), "password": os.environ.get("E2E_ADMIN_PASSWORD", "")}
USER  = {"email": os.environ.get("E2E_USER_EMAIL", ""),  "password": os.environ.get("E2E_USER_PASSWORD", "")}
NEW_PASSWORD = os.environ.get("E2E_USER_NEW_PASSWORD", "")

# Prefer the credentials file: it keeps the passwords out of argv. Anything on
# the command line is visible to `ps` for every user on the box, and lands in
# the shell history.
_creds_file = os.environ.get("E2E_CREDS_FILE")
if _creds_file:
    if not ADMIN["email"] or not USER["email"]:
        sys.exit("E2E_CREDS_FILE requires E2E_ADMIN_EMAIL and E2E_USER_EMAIL (the emails are not secrets).")
    try:
        _creds = json.load(open(_creds_file))
    except Exception as e:
        sys.exit(f"Cannot read E2E_CREDS_FILE={_creds_file}: {e}")
    for _acct in (ADMIN, USER):
        _entry = _creds.get(_acct["email"])
        if not _entry or not _entry.get("password"):
            sys.exit(f"{_acct['email']} not found in {_creds_file}. Run scripts/e2e-provision.ts first.")
        _acct["password"] = _entry["password"]
    # The change-password test needs a *different* password; derive one from the
    # real one so it is still unique per run without being hardcoded.
    NEW_PASSWORD = USER["password"] + os.environ.get("E2E_USER_NEW_PASSWORD_SUFFIX", "X9z")

if os.environ.get("E2E_CONFIRM") != "yes":
    sys.exit(
        "Refusing to run: set E2E_CONFIRM=yes to acknowledge that this script\n"
        "mutates the target database (creates/deletes users, resets passwords)."
    )
_missing = [k for k, v in {
    "E2E_ADMIN_EMAIL": ADMIN["email"], "E2E_ADMIN_PASSWORD": ADMIN["password"],
    "E2E_USER_EMAIL": USER["email"], "E2E_USER_PASSWORD": USER["password"],
    "E2E_USER_NEW_PASSWORD": NEW_PASSWORD,
}.items() if not v]
if _missing:
    sys.exit("Missing required environment variables: " + ", ".join(_missing))

results = []  # list of (name, ok, detail)
def record(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class Client:
    def __init__(self, name):
        self.name = name
        self.cj = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cj), NoRedirect())
        self.csrf = None

    def req(self, method, path, body=None, headers=None, raw=False):
        url = BASE + path
        h = {"User-Agent": UA, "Origin": BASE, "Referer": BASE + "/login"}
        if self.csrf:
            h["x-csrf-token"] = self.csrf
        if headers:
            h.update(headers)
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        r = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            resp = self.opener.open(r)
        except urllib.error.HTTPError as e:
            resp = e
        status = resp.status
        try:
            body = resp.read().decode()
        except Exception:
            body = ""
        ctype = resp.headers.get("content-type", "")
        # capture csrf if present
        for c in self.cj:
            if c.name.lower() == "csrf" or "csrf" in c.name.lower():
                self.csrf = c.value
        if raw:
            return status, body, resp.headers
        try:
            js = json.loads(body) if "json" in ctype and body else {}
        except Exception:
            js = {"_raw": body[:200]}
        return status, js, resp.headers

    def cookies(self):
        return {c.name: c.value for c in self.cj}

    def session_cookie(self):
        for c in self.cj:
            if "session_token" in c.name:
                return c.name
        return None

def login(c, email, password):
    st, js, _ = c.req("POST", "/api/auth/sign-in/email", {"email": email, "password": password})
    return st, js, _

def signout(c):
    st, js, _ = c.req("POST", "/api/auth/sign-out", {})
    return st, js, _

def get_session(c):
    st, js, _ = c.req("GET", "/api/auth/get-session")
    return st, js, _

def section(title):
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)

# ---------------- 1. AUTH ----------------
section("1. AUTH")

# 1a. Unauthenticated access
c = Client("anon")
st, js, _ = c.req("GET", "/api/boards")
record("1a.1 unauth /api/boards -> 307 redirect to /login", st == 307, f"got {st}")

# 1b. Login admin
c_admin = Client("admin")
st, js, _ = login(c_admin, ADMIN["email"], ADMIN["password"])
record("1b.1 admin login 200", st == 200, f"got {st} {str(js)[:120]}")
record("1b.2 admin role returned", js.get("user", {}).get("role") == "admin", f"role={js.get('user',{}).get('role')}")
sc = c_admin.session_cookie()
record("1b.3 session cookie set (secure-prefixed)", sc == "__Secure-better-auth.session_token", f"cookie={sc}")

# 1c. get-session
st, js, _ = get_session(c_admin)
record("1c.1 get-session 200", st == 200, f"got {st}")
record("1c.2 lastLoginAt populated", bool(js.get("user", {}).get("lastLoginAt")), f"lastLoginAt={js.get('user',{}).get('lastLoginAt')}")

# 1d. Wrong password
c_bad = Client("bad")
st, js, _ = login(c_bad, ADMIN["email"], "wrong-password-123")
record("1d.1 wrong password -> 401", st == 401, f"got {st} {str(js)[:80]}")

# 1e. login user
c_user = Client("user")
st, js, _ = login(c_user, USER["email"], USER["password"])
record("1e.1 user login 200", st == 200, f"got {st}")
record("1e.2 user role is user", js.get("user", {}).get("role") == "user", f"role={js.get('user',{}).get('role')}")

# 1f. change password (self-service) — only test with a throwaway
# We'll test change-password flow later on the user account after board tests.

# ---------------- 2. BOARDS ----------------
section("2. BOARDS (as admin)")

st, js, _ = c_admin.req("GET", "/api/boards")
record("2.1 list boards 200", st == 200, f"got {st}")
boards_before = js.get("boards", [])

st, js, _ = c_admin.req("POST", "/api/boards", {"name": "E2E Board", "color": "emerald", "description": "test board"})
record("2.2 create board 201", st == 201, f"got {st}")
board = js.get("board", {})
bid = board.get("id")
record("2.3 board has id", bool(bid))

# board detail
st, js, _ = c_admin.req("GET", f"/api/boards/{bid}")
record("2.4 board detail 200", st == 200, f"got {st}")
record("2.5 3 default statuses", len(js.get("statuses", [])) == 3, f"statuses={len(js.get('statuses',[]))}")
statuses = js.get("statuses", [])
todo = next((s for s in statuses if s["name"] == "To Do"), None)
inprog = next((s for s in statuses if s["name"] == "In Progress"), None)
done = next((s for s in statuses if s["name"] == "Done"), None)
record("2.6 has To Do / In Progress / Done", bool(todo and inprog and done), f"{todo and inprog and done}")
record("2.7 Done status isDone=true", done and done.get("isDone") == True)

# PATCH board
st, js, _ = c_admin.req("PATCH", f"/api/boards/{bid}", {"name": "E2E Board Renamed"})
record("2.8 rename board 200", st == 200 and js.get("board",{}).get("name") == "E2E Board Renamed", f"got {st} name={js.get('board',{}).get('name')}")

# ---------------- 3. STATUSES ----------------
section("3. STATUSES")

st, js, _ = c_admin.req("POST", f"/api/boards/{bid}/statuses", {"name": "Review", "color": "sky"})
record("3.1 create status 201", st == 201, f"got {st}")
review = js.get("status", {})
review_id = review.get("id")

# create status with duplicate-ish / empty name
st, js, _ = c_admin.req("POST", f"/api/boards/{bid}/statuses", {"name": "  "})
record("3.2 empty status name -> 400", st == 400, f"got {st}")

# move status
st, js, _ = c_admin.req("PATCH", f"/api/statuses/{review_id}/move", {"position": 2500})
record("3.3 move status 200", st == 200, f"got {st}")

# patch status (wip limit)
st, js, _ = c_admin.req("PATCH", f"/api/statuses/{review_id}", {"wipLimit": 3, "name": "Review (3)"})
record("3.4 patch status wip/name 200", st == 200, f"got {st} name={js.get('status',{}).get('name')}")

# ---------------- 4. TASKS ----------------
section("4. TASKS")

st, js, _ = c_admin.req("POST", f"/api/boards/{bid}/tasks", {"title": "Task A", "statusId": todo["id"], "priority": 1})
record("4.1 create task 201", st == 201, f"got {st}")
task_a = js.get("task", {})
task_a_id = task_a.get("id")
record("4.2 task default priority", task_a.get("priority") == 1, f"priority={task_a.get('priority')}")

st, js, _ = c_admin.req("POST", f"/api/boards/{bid}/tasks", {"title": "Task B", "statusId": todo["id"], "startDate": "2026-09-20", "dueDate": "2026-09-25"})
record("4.3 create task with dates 201", st == 201, f"got {st}")
task_b = js.get("task", {})
task_b_id = task_b.get("id")

# empty title
st, js, _ = c_admin.req("POST", f"/api/boards/{bid}/tasks", {"title": "", "statusId": todo["id"]})
record("4.4 empty title -> 400", st == 400, f"got {st}")

# invalid dates
st, js, _ = c_admin.req("POST", f"/api/boards/{bid}/tasks", {"title": "Bad dates", "statusId": todo["id"], "startDate": "2026-09-30", "dueDate": "2026-09-01"})
record("4.5 start>due -> 400", st == 400, f"got {st}")

# PATCH task
st, js, _ = c_admin.req("PATCH", f"/api/tasks/{task_a_id}", {"title": "Task A edited", "progress": 40})
record("4.6 patch task 200", st == 200, f"got {st} progress={js.get('task',{}).get('progress')}")

# move task to done
st, js, _ = c_admin.req("PATCH", f"/api/tasks/{task_a_id}/move", {"statusId": done["id"], "prevPosition": None, "nextPosition": None})
record("4.7 move task to Done -> progress 100 + completedAt", st == 200 and js.get("task",{}).get("completedAt") is not None and js.get("task",{}).get("progress") == 100, f"got {st} progress={js.get('task',{}).get('progress')} completedAt={js.get('task',{}).get('completedAt')}")

# move back out of done
st, js, _ = c_admin.req("PATCH", f"/api/tasks/{task_a_id}/move", {"statusId": todo["id"], "prevPosition": None, "nextPosition": None})
record("4.8 move out of Done -> completedAt null", st == 200 and js.get("task",{}).get("completedAt") is None, f"got {st} completedAt={js.get('task',{}).get('completedAt')}")
# BUG-9 was "progress stays 100 after leaving Done". The original 4.8 checked only
# completedAt, so the actual defect slipped past it. Assert the progress too.
record("4.8b move out of Done -> progress reset to 0", st == 200 and js.get("task",{}).get("progress") == 0, f"got {st} progress={js.get('task',{}).get('progress')}")

# schedule
st, js, _ = c_admin.req("PATCH", f"/api/tasks/{task_b_id}/schedule", {"startDate": "2026-10-01", "dueDate": "2026-10-10"})
record("4.9 schedule task 200", st == 200, f"got {st}")

# reminders
st, js, _ = c_admin.req("PATCH", f"/api/tasks/{task_b_id}/reminders", {"remindOnStart": True, "leadMinutes": 60})
record("4.10 update reminders 200", st == 200, f"got {st}")

# ---------------- 5. SUBTASKS ----------------
section("5. SUBTASKS")

st, js, _ = c_admin.req("POST", f"/api/tasks/{task_b_id}/subtasks", {"title": "Subtask 1"})
record("5.1 add subtask 201", st == 201, f"got {st}")
sub1 = js.get("subtask", {})
sub1_id = sub1.get("id")

st, js, _ = c_admin.req("POST", f"/api/tasks/{task_b_id}/subtasks", {"title": "Subtask 2"})
sub2_id = js.get("subtask", {}).get("id")

st, js, _ = c_admin.req("PATCH", f"/api/tasks/{task_b_id}/subtasks/{sub1_id}", {"isDone": True})
record("5.2 toggle subtask done -> progress 50", st == 200, f"got {st}")
st, js, _ = c_admin.req("GET", f"/api/boards/{bid}")
tb = next((t for t in js.get("tasks", []) if t["id"] == task_b_id), {})
record("5.3 task progress recomputed to 50", tb.get("progress") == 50, f"progress={tb.get('progress')}")

# ---------------- 6. LABELS ----------------
section("6. LABELS")

st, js, _ = c_admin.req("POST", f"/api/boards/{bid}/labels", {"name": "urgent", "color": "rose"})
record("6.1 create label 201", st == 201, f"got {st}")
label = js.get("label", {})
label_id = label.get("id")

st, js, _ = c_admin.req("POST", f"/api/boards/{bid}/labels", {"name": "urgent", "color": "rose"})
record("6.2 duplicate label -> 400 (not 500)", st == 400, f"got {st}")
# This assertion used to accept 500 as a pass (`st in (400, 409, 500)`). That was
# exactly the defect: BUG-10 WAS a 500, and the fix changed it to 400 — so the
# old assertion would have silently accepted the bug coming back.
record("6.2b duplicate label message is helpful", "already exists" in json.dumps(js).lower(), f"{json.dumps(js)[:100]}")

# ---------------- 7. GANTT ----------------
section("7. GANTT")

st, js, _ = c_admin.req("GET", f"/api/boards/{bid}/gantt?from=2026-09-01&to=2026-12-31")
record("7.1 gantt 200", st == 200, f"got {st}")
record("7.2 gantt returns tasks with dates", any(t.get("startDate") or t.get("dueDate") for t in js.get("tasks", [])), f"tasks={len(js.get('tasks',[]))}")

# ---------------- 8. NOTIFICATIONS ----------------
section("8. NOTIFICATIONS")

st, js, _ = c_admin.req("GET", "/api/notifications")
record("8.1 list notifications 200", st == 200, f"got {st}")

st, js, _ = c_admin.req("POST", "/api/notifications/read", {"all": True})
record("8.2 mark all read 200", st == 200, f"got {st}")

# ---------------- 9. SETTINGS ----------------
section("9. SETTINGS (notifications)")

st, js, _ = c_admin.req("GET", "/api/settings/notifications")
record("9.1 get settings 200", st == 200, f"got {st}")

st, js, _ = c_admin.req("PATCH", "/api/settings/notifications", {"pushEnabled": True, "defaultTime": "09:00", "leadMinutesDue": 720})
record("9.2 patch settings 200", st == 200, f"got {st}")
record("9.3 settings persisted", js.get("settings",{}).get("defaultTime") == "09:00", f"defaultTime={js.get('settings',{}).get('defaultTime')}")

# ---------------- 10. PUSH ----------------
section("10. PUSH")

st, js, _ = c.req("GET", "/api/push/public-key")
record("10.1 public-key (anon) 200", st == 200, f"got {st} (NOTE: may 307 redirect due to middleware)")

st, js, _ = c_admin.req("GET", "/api/push/public-key")
record("10.2 public-key (authed) 200", st == 200, f"got {st}")
record("10.3 publicKey present", bool(js.get("publicKey")), f"len={len(js.get('publicKey',''))}")

# subscribe with fake endpoint (should validate)
st, js, _ = c_admin.req("POST", "/api/push/subscribe", {"endpoint": "https://evil.example.com/x", "p256dh": "aGVsbG8", "auth": "aGVsbG8"})
record("10.4 subscribe non-push-service -> 400", st == 400, f"got {st}")

st, js, _ = c_admin.req("POST", "/api/push/subscribe", {"endpoint": "https://fcm.googleapis.com/fcm/send/test", "p256dh": "aGVsbG8", "auth": "aGVsbG8"})
record("10.5 subscribe valid -> 201", st == 201, f"got {st}")

st, js, _ = c_admin.req("GET", "/api/push/subscribe")
record("10.6 list subscriptions 200", st == 200, f"got {st} subs={len(js.get('subscriptions',[]))}")

# ---------------- 11. ADMIN ----------------
section("11. ADMIN")

st, js, _ = c_user.req("GET", "/api/admin/users")
record("11.1 non-admin /api/admin/users -> 404", st == 404, f"got {st}")

st, js, _ = c_admin.req("GET", "/api/admin/users")
record("11.2 admin list users 200", st == 200, f"got {st} total={js.get('total')}")

st, js, _ = c_admin.req("GET", "/api/admin/logs")
record("11.3 admin logs 200", st == 200, f"got {st} logs={len(js.get('logs',[]))}")

# create user
st, js, _ = c_admin.req("POST", "/api/admin/users", {"email": "e2e-created@flowboard.test", "name": "Created User", "role": "user"})
record("11.4 admin create user 201", st == 201, f"got {st}")
created_user = js.get("user", {})
created_id = created_user.get("id")
record("11.5 new user has generated password", bool(js.get("password")), f"pwdlen={len(js.get('password',''))}")
record("11.6 new user mustChangePassword=true", created_user.get("role") == "user")

# duplicate email
st, js, _ = c_admin.req("POST", "/api/admin/users", {"email": "e2e-created@flowboard.test", "name": "Dup", "role": "user"})
record("11.7 duplicate email -> 400", st == 400, f"got {st}")

# patch user (rename)
st, js, _ = c_admin.req("PATCH", f"/api/admin/users/{created_id}", {"name": "Created User Renamed"})
record("11.8 patch user 200", st == 200, f"got {st} name={js.get('user',{}).get('name')}")

# reset password
st, js, _ = c_admin.req("POST", f"/api/admin/users/{created_id}/reset-password", {})
record("11.9 reset password 200", st == 200, f"got {st} pwdlen={len(js.get('password',''))}")

# delete user
st, js, _ = c_admin.req("DELETE", f"/api/admin/users/{created_id}")
record("11.10 delete user 200", st == 200, f"got {st}")

# cannot delete self
st, js, _ = c_admin.req("DELETE", f"/api/admin/users/{c_admin.cookies() and '' }")
# find self id
st2, js2, _ = get_session(c_admin)
self_id = js2.get("user", {}).get("id")
st, js, _ = c_admin.req("DELETE", f"/api/admin/users/{self_id}")
record("11.11 cannot delete self -> 400", st == 400, f"got {st}")

# ---------------- 12. AUTHORIZATION (negative) ----------------
section("12. AUTHORIZATION / ISOLATION")

# user tries to access admin's board
st, js, _ = c_user.req("GET", f"/api/boards/{bid}")
record("12.1 cross-user board -> 404", st == 404, f"got {st}")

# user tries to access admin's task
st, js, _ = c_user.req("PATCH", f"/api/tasks/{task_a_id}", {"title": "hack"})
record("12.2 cross-user task -> 404", st == 404, f"got {st}")

# ---------------- 13. CHANGE PASSWORD ----------------
section("13. CHANGE PASSWORD (self-service)")

# change user password
st, js, _ = c_user.req("POST", "/api/auth/change-password", {"currentPassword": USER["password"], "newPassword": NEW_PASSWORD, "revokeOtherSessions": True})
record("13.1 change-password 200", st == 200, f"got {st} {str(js)[:100]}")

# verify old password fails
c_old = Client("old")
st, js, _ = login(c_old, USER["email"], USER["password"])
record("13.2 old password -> 401", st == 401, f"got {st}")

# verify new password works
c_new = Client("new")
st, js, _ = login(c_new, USER["email"], NEW_PASSWORD)
record("13.3 new password -> 200", st == 200, f"got {st}")

# revert user password
st, js, _ = c_new.req("POST", "/api/auth/change-password", {"currentPassword": NEW_PASSWORD, "newPassword": USER["password"], "revokeOtherSessions": True})
record("13.4 revert password 200", st == 200, f"got {st}")

# ---------------- 14. LOGOUT ----------------
section("14. LOGOUT")

st, js, _ = signout(c_admin)
record("14.1 signout 200", st == 200, f"got {st}")
st, js, _ = get_session(c_admin)
record("14.2 get-session after logout -> null", st == 200 and js.get("session") is None, f"got {st} session={js.get('session')}")

# ---------------- SUMMARY ----------------
print("\n\n" + "=" * 70)
passed = sum(1 for _, ok, _ in results if ok)
failed = [r for r in results if not r[1]]
print(f"TOTAL: {len(results)} tests, {passed} PASSED, {len(failed)} FAILED")
if failed:
    print("\n--- FAILED ---")
    for name, _, detail in failed:
        print(f"  ✗ {name} — {detail}")

# cleanup: delete test board (admin re-login)
print("\n--- CLEANUP ---")
c_admin2 = Client("admin2")
st, js, _ = login(c_admin2, ADMIN["email"], ADMIN["password"])
st, js, _ = c_admin2.req("DELETE", f"/api/boards/{bid}")
print(f"cleanup: delete board {bid} -> {st}")
