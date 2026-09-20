import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  smallint,
  numeric,
  date,
  time,
  bigint,
  jsonb,
  uuid,
  uniqueIndex,
  index,
  check,
  pgEnum,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* =====================================================================
 * AUTH — self-hosted better-auth (PRD §6.3 Option B)
 * Tables must match the better-auth drizzle adapter exactly (snake_case
 * columns, singular table names). Role / ban / timezone / password-change
 * fields are declared here AND in lib/auth.ts additionalFields.
 * ===================================================================== */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),

  // --- app-specific additionalFields ---
  role: text("role").notNull().default("user"), // 'user' | 'admin'
  banned: boolean("banned").notNull().default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  timezone: text("timezone").notNull().default("Asia/Makassar"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  lastLoginAt: timestamp("last_login_at"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
});

/* =====================================================================
 * DOMAIN (PRD §6.3 — identical for both auth options)
 * ===================================================================== */

export const boards = pgTable(
  "boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color").notNull().default("indigo"),
    position: numeric("position").notNull().default("1000"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_boards_user").on(t.userId, t.isArchived, t.position),
  ]
);

export const statuses = pgTable(
  "statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("slate"),
    position: numeric("position").notNull(),
    wipLimit: integer("wip_limit"),
    isDone: boolean("is_done").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("idx_statuses_board").on(t.boardId, t.position)]
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    statusId: uuid("status_id")
      .notNull()
      .references(() => statuses.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    priority: smallint("priority").notNull().default(2), // 1 urgent … 4 low

    // --- the task's schedule / "target" ---
    startDate: date("start_date"),
    dueDate: date("due_date"),
    dueTime: time("due_time"),
    remindOnStart: boolean("remind_on_start").notNull().default(true),
    remindLeadMinutes: integer("remind_lead_minutes"), // NULL = follow user settings
    remindersMuted: boolean("reminders_muted").notNull().default(false),

    progress: smallint("progress").notNull().default(0),
    position: numeric("position").notNull(),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_tasks_status").on(t.statusId, t.position),
    index("idx_tasks_board").on(t.boardId),
    index("idx_tasks_timeline").on(t.boardId, t.startDate, t.dueDate),
    index("idx_tasks_due")
      .on(t.dueDate)
      .where(sql`${t.completedAt} IS NULL`),
    check("chk_task_priority", sql`${t.priority} BETWEEN 1 AND 4`),
    check("chk_task_progress", sql`${t.progress} BETWEEN 0 AND 100`),
    check(
      "chk_task_dates",
      sql`${t.startDate} IS NULL OR ${t.dueDate} IS NULL OR ${t.startDate} <= ${t.dueDate}`
    ),
  ]
);

export const subtasks = pgTable(
  "subtasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    isDone: boolean("is_done").notNull().default(false),
    position: numeric("position").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_subtasks_task").on(t.taskId, t.position)]
);

export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
  },
  (t) => [uniqueIndex("uq_labels_board_name").on(t.boardId, t.name)]
);

export const taskLabels = pgTable(
  "task_labels",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.labelId] }),
    index("idx_task_labels_label").on(t.labelId),
  ]
);

/* ===================== NOTIFICATIONS ===================== */

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    deviceLabel: text("device_label"),
    isStandalone: boolean("is_standalone").notNull().default(false),
    failureCount: smallint("failure_count").notNull().default(0),
    lastSuccessAt: timestamp("last_success_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_push_user").on(t.userId)]
);

export const notificationSettings = pgTable("notification_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  defaultTime: time("default_time").notNull().default("08:00"),
  leadMinutesStart: integer("lead_minutes_start").notNull().default(0),
  leadMinutesDue: integer("lead_minutes_due").notNull().default(1440),
  notifyDueToday: boolean("notify_due_today").notNull().default(true),
  notifyOverdue: boolean("notify_overdue").notNull().default(true),
  quietStart: time("quiet_start").notNull().default("22:00"),
  quietEnd: time("quiet_end").notNull().default("07:00"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const notificationKind = pgEnum("notification_kind", [
  "start_soon",
  "due_soon",
  "due_today",
  "overdue",
]);

export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
  "skipped",
  "cancelled",
]);

export const notificationQueue = pgTable(
  "notification_queue",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    kind: notificationKind("kind").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    status: notificationStatus("status").notNull().default("pending"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_queue_task_kind").on(t.taskId, t.kind),
    index("idx_queue_due")
      .on(t.status, t.scheduledFor)
      .where(sql`${t.status} = 'pending'`),
    index("idx_queue_inbox")
      .on(t.userId, t.sentAt)
      .where(sql`${t.status} = 'sent'`),
  ]
);

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_activity_actor").on(t.actorId, t.createdAt)]
);

/* Login rate-limiting (PRD §F-1.1): 5 failures/email/15min, 20/IP/15min.
 * A dedicated table keeps failure counters durable across Worker isolates,
 * unlike better-auth's default in-memory rate limiter. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    email: text("email").notNull(),
    ip: text("ip"),
    success: boolean("success").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_login_attempts_email").on(t.email, t.createdAt),
    index("idx_login_attempts_ip").on(t.ip, t.createdAt),
  ]
);

/* =====================================================================
 * PUBLIC API KEYS
 * Each user may mint personal API keys that authenticate the /api/v1
 * endpoints (integration with third-party systems, Hermes, scripts…).
 *
 * Security model:
 *  - Only the SHA-256 hash of the key is stored; the plaintext is shown
 *    exactly once, at creation time, and is unrecoverable afterwards.
 *  - `prefix` is stored in the clear purely so the UI can display which
 *    key is which ("fbk_1a2b…").
 *  - A key always resolves to exactly one owner; every /api/v1 query is
 *    scoped to that user, so a key can never reach another user's data.
 * ===================================================================== */

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(), // e.g. "fbk_1a2b3c4d" — display only
    keyHash: text("key_hash").notNull().unique(), // sha256(plaintext), hex
    scopes: jsonb("scopes").$type<string[]>().notNull().default(["read", "write"]),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_api_keys_user").on(t.userId, t.revokedAt),
    index("idx_api_keys_prefix").on(t.prefix),
  ]
);

/** Durable per-key request counter (Workers isolates do not share memory). */
export const apiRateLimits = pgTable(
  "api_rate_limits",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    keyId: uuid("key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("uq_api_rate_key_window").on(t.keyId, t.windowStart)]
);
