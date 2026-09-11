import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { digest } from "./files.js";
import { id } from "./schema.js";
import { TeamError } from "./team-protocol.js";
import type { Registry } from "./registry.js";
import type { SecretPrefix } from "./secrets.js";

export const roleSchema = z.enum(["admin", "member"]);
export const passwordSchema = z.string().min(12).max(256);
export const emailSchema = z
  .string()
  .trim()
  .pipe(z.email().max(254))
  .transform((v) => v.toLowerCase());
export const personSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: emailSchema,
  actorId: id,
});
export type WebUser = {
  userId: string;
  actorId: string;
  email: string;
  name: string;
  role: "admin" | "member";
  disabledAt: string | null;
  createdAt: string;
};
const token = (prefix: SecretPrefix) =>
  `${prefix}_${randomBytes(32).toString("hex")}`;
const now = () => new Date().toISOString();
const future = (ms: number) => new Date(Date.now() + ms).toISOString();
const deny = (status: number, code: string, message: string): never => {
  throw new TeamError(status, code, message);
};
const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex"));

export function migrateWebAuth(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS web_users (
      user_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')),
      disabled_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS web_sessions (
      session_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES web_users(user_id), csrf TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions(user_id);
    CREATE TABLE IF NOT EXISTS web_challenges (
      challenge_id TEXT PRIMARY KEY, kind TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      email TEXT, actor_id TEXT, role TEXT, user_id TEXT REFERENCES web_users(user_id),
      created_by TEXT REFERENCES web_users(user_id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      consumed_at TEXT, revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS web_device_requests (
      request_id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL UNIQUE, user_code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_poll_at INTEGER,
      approved_by TEXT REFERENCES web_users(user_id), denied_at TEXT, consumed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS web_device_tokens (
      token_id TEXT PRIMARY KEY REFERENCES tokens(token_id), user_id TEXT NOT NULL REFERENCES web_users(user_id),
      label TEXT NOT NULL, last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_actor ON tokens(actor_id);
    CREATE TABLE IF NOT EXISTS web_rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, until_ms INTEGER NOT NULL);
  `);
}

let hashJobs = 0;
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (hashJobs >= 2)
    return deny(429, "auth_busy", "Sign-in is busy. Please try again shortly.");
  hashJobs++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        salt,
        64,
        { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      ),
    );
  } finally {
    hashJobs--;
  }
}
async function passwordHash(password: string) {
  passwordSchema.parse(password);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt:131072:8:1:${salt.toString("hex")}:${key.toString("hex")}`;
}
async function passwordMatches(password: string, encoded: string | undefined) {
  const parts = /^scrypt:131072:8:1:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(
    encoded ?? "",
  );
  // Unknown accounts incur the same password hashing work as known accounts.
  const key = await derive(
    password,
    Buffer.from(parts?.[1] ?? "0".repeat(32), "hex"),
  );
  return (
    timingSafeEqual(key, Buffer.from(parts?.[2] ?? "0".repeat(128), "hex")) &&
    Boolean(parts)
  );
}

export class WebAuth {
  readonly db: DatabaseSync;
  constructor(readonly registry: Registry) {
    this.db = registry.db;
  }
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  setupRequired() {
    return (
      Number(
        this.db.prepare("SELECT COUNT(*) AS n FROM web_users").get()!.n,
      ) === 0
    );
  }
  rateLimit(bucket: string, limit = 30, windowMs = 300_000) {
    const at = Date.now();
    const key = digest(bucket);
    this.db
      .prepare(
        `INSERT INTO web_rate_limits(bucket,count,until_ms) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET
      count=CASE WHEN until_ms<=? THEN 1 ELSE count+1 END, until_ms=CASE WHEN until_ms<=? THEN ? ELSE until_ms END`,
      )
      .run(key, at + windowMs, at, at, at + windowMs);
    if (
      Number(
        this.db
          .prepare("SELECT count FROM web_rate_limits WHERE bucket=?")
          .get(key)!.count,
      ) > limit
    )
      return deny(
        429,
        "rate_limited",
        "Too many attempts. Please try again in a few minutes.",
      );
    this.db
      .prepare("DELETE FROM web_rate_limits WHERE until_ms<?")
      .run(at - 86_400_000);
  }
  users(): WebUser[] {
    return this.db
      .prepare(
        "SELECT user_id AS userId,actor_id AS actorId,email,name,role,disabled_at AS disabledAt,created_at AS createdAt FROM web_users ORDER BY created_at",
      )
      .all() as unknown as WebUser[];
  }
  private user(userId: string): WebUser {
    const row = this.db
      .prepare(
        "SELECT user_id AS userId,actor_id AS actorId,email,name,role,disabled_at AS disabledAt,created_at AS createdAt FROM web_users WHERE user_id=?",
      )
      .get(userId) as unknown as WebUser | undefined;
    if (!row || row.disabledAt)
      return deny(
        401,
        "account_unavailable",
        "This account is unavailable. Contact your admin.",
      );
    return row;
  }
  requireAdmin(user: WebUser) {
    if (this.user(user.userId).role !== "admin")
      return deny(403, "admin_required", "Only admins can manage team access.");
  }
  private newSession(userId: string) {
    const sessionToken = token("pss");
    const csrf = randomBytes(32).toString("hex");
    const expiresAt = future(7 * 86_400_000);
    this.db.prepare("DELETE FROM web_sessions WHERE expires_at<=?").run(now());
    this.db
      .prepare(
        "INSERT INTO web_sessions(session_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)",
      )
      .run(digest(sessionToken), userId, csrf, expiresAt);
    return { sessionToken, csrf, user: this.user(userId), expiresAt };
  }
  session(cookie: string | undefined) {
    const value = /(?:^|;\s*)pi_share_session=(pss_[a-f0-9]{64})(?:;|$)/.exec(
      cookie ?? "",
    )?.[1];
    if (!value) return null;
    const row = this.db
      .prepare(
        "SELECT user_id,csrf FROM web_sessions WHERE session_hash=? AND expires_at>?",
      )
      .get(digest(value), now());
    if (!row) return null;
    try {
      return {
        user: this.user(String(row.user_id)),
        csrf: String(row.csrf),
        sessionHash: digest(value),
      };
    } catch {
      return null;
    }
  }
  checkCsrf(
    session: NonNullable<ReturnType<WebAuth["session"]>>,
    csrf: string | undefined,
  ) {
    if (!csrf || !equal(session.csrf, csrf))
      return deny(403, "csrf_failed", "Refresh the page and try again.");
  }
  logout(sessionHash: string) {
    this.db
      .prepare("DELETE FROM web_sessions WHERE session_hash=?")
      .run(sessionHash);
  }
  issueSetup() {
    return this.tx(() => {
      if (!this.setupRequired())
        return deny(
          409,
          "setup_closed",
          "The admin account has already been created.",
        );
      this.db
        .prepare(
          "UPDATE web_challenges SET revoked_at=? WHERE kind='setup' AND consumed_at IS NULL",
        )
        .run(now());
      return this.newChallenge("setup", {});
    });
  }
  private newChallenge(
    kind: "setup" | "invite" | "reset",
    input: {
      email?: string;
      actorId?: string;
      role?: string;
      userId?: string;
      createdBy?: string;
    },
  ) {
    const secret = token(
      kind === "setup" ? "psb" : kind === "invite" ? "psi" : "psr",
    );
    const challengeId = randomUUID();
    const expiresAt = future(kind === "invite" ? 7 * 86_400_000 : 30 * 60_000);
    this.db
      .prepare(
        "INSERT INTO web_challenges(challenge_id,kind,token_hash,email,actor_id,role,user_id,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        challengeId,
        kind,
        digest(secret),
        input.email ?? null,
        input.actorId ?? null,
        input.role ?? null,
        input.userId ?? null,
        input.createdBy ?? null,
        now(),
        expiresAt,
      );
    return { challengeId, token: secret, expiresAt };
  }
  private challenge(secret: string, kind: string) {
    if (!/^ps[bir]_[a-f0-9]{64}$/.test(secret))
      return deny(
        400,
        "invalid_link",
        "This link is invalid, expired, or already used.",
      );
    const row = this.db
      .prepare(
        "SELECT * FROM web_challenges WHERE token_hash=? AND kind=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?",
      )
      .get(digest(secret), kind, now());
    if (!row)
      return deny(
        400,
        "invalid_link",
        "This link is invalid, expired, or already used.",
      );
    if (row.created_by) this.requireAdmin(this.user(String(row.created_by)));
    return row;
  }
  challengeInfo(secret: string, kind: "invite" | "reset") {
    const row = this.challenge(secret, kind);
    return {
      email: String(row.email),
      actorId: row.actor_id,
      role: row.role,
      expiresAt: String(row.expires_at),
    };
  }
  async setup(
    input: z.infer<typeof personSchema> & { password: string; token: string },
  ) {
    input = { ...input, ...personSchema.parse(input) };
    this.challenge(input.token, "setup");
    const encoded = await passwordHash(input.password);
    return this.tx(() => {
      if (!this.setupRequired())
        return deny(
          409,
          "setup_closed",
          "The admin account has already been created.",
        );
      const challenge = this.challenge(input.token, "setup");
      const userId = randomUUID();
      this.db
        .prepare(
          "INSERT INTO web_users(user_id,actor_id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,'admin',?)",
        )
        .run(userId, input.actorId, input.email, input.name, encoded, now());
      this.db
        .prepare("UPDATE web_challenges SET consumed_at=? WHERE challenge_id=?")
        .run(now(), String(challenge.challenge_id));
      return this.newSession(userId);
    });
  }
  async login(email: string, password: string) {
    const normalized = emailSchema.parse(email);
    passwordSchema.parse(password);
    this.rateLimit(`login-email:${normalized}`, 10);
    const row = this.db
      .prepare(
        "SELECT user_id,password_hash,disabled_at FROM web_users WHERE email=?",
      )
      .get(normalized);
    if (
      !(await passwordMatches(
        password,
        row ? String(row.password_hash) : undefined,
      )) ||
      !row ||
      row.disabled_at
    )
      return deny(401, "invalid_login", "Email or password is incorrect.");
    return this.tx(() => {
      const current = this.db
        .prepare(
          "SELECT password_hash,disabled_at FROM web_users WHERE user_id=?",
        )
        .get(row.user_id!);
      if (
        !current ||
        current.disabled_at ||
        current.password_hash !== row.password_hash
      )
        return deny(401, "invalid_login", "Email or password is incorrect.");
      return this.newSession(String(row.user_id));
    });
  }
  invite(
    user: WebUser,
    input: { email: string; actorId: string; role: "admin" | "member" },
  ) {
    this.requireAdmin(user);
    const email = emailSchema.parse(input.email);
    id.parse(input.actorId);
    roleSchema.parse(input.role);
    return this.tx(() => {
      if (
        this.db
          .prepare("SELECT 1 FROM web_users WHERE email=? OR actor_id=?")
          .get(email, input.actorId)
      )
        return deny(
          409,
          "account_exists",
          "An account already uses this email or member handle.",
        );
      if (
        this.db
          .prepare(
            "SELECT 1 FROM web_challenges WHERE kind='invite' AND (email=? OR actor_id=?) AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?",
          )
          .get(email, input.actorId, now())
      )
        return deny(
          409,
          "invite_exists",
          "An active invitation already exists. Revoke it before creating another.",
        );
      return this.newChallenge("invite", {
        ...input,
        email,
        createdBy: user.userId,
      });
    });
  }
  invitations(user: WebUser) {
    this.requireAdmin(user);
    return this.db
      .prepare(
        "SELECT challenge_id AS challengeId,email,actor_id AS actorId,role,expires_at AS expiresAt,consumed_at AS consumedAt,revoked_at AS revokedAt FROM web_challenges WHERE kind='invite' ORDER BY created_at DESC",
      )
      .all();
  }
  revokeInvitation(user: WebUser, challengeId: string) {
    this.requireAdmin(user);
    this.db
      .prepare(
        "UPDATE web_challenges SET revoked_at=? WHERE challenge_id=? AND kind='invite'",
      )
      .run(now(), challengeId);
  }
  async join(input: { token: string; name: string; password: string }) {
    this.challenge(input.token, "invite");
    const name = z.string().trim().min(1).max(100).parse(input.name);
    const encoded = await passwordHash(input.password);
    return this.tx(() => {
      const c = this.challenge(input.token, "invite");
      const userId = randomUUID();
      if (
        this.db
          .prepare("SELECT 1 FROM web_users WHERE email=? OR actor_id=?")
          .get(c.email!, c.actor_id!)
      )
        return deny(
          409,
          "account_exists",
          "This account already exists. Sign in instead.",
        );
      this.db
        .prepare(
          "INSERT INTO web_users(user_id,actor_id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(userId, c.actor_id!, c.email!, name, encoded, c.role!, now());
      this.db
        .prepare("UPDATE web_challenges SET consumed_at=? WHERE challenge_id=?")
        .run(now(), String(c.challenge_id));
      return this.newSession(userId);
    });
  }
  resetLink(userId: string, admin?: WebUser) {
    if (admin) this.requireAdmin(admin);
    const user = this.user(userId);
    return this.tx(() => {
      this.db
        .prepare(
          "UPDATE web_challenges SET revoked_at=? WHERE kind='reset' AND user_id=? AND consumed_at IS NULL",
        )
        .run(now(), userId);
      return this.newChallenge("reset", {
        email: user.email,
        userId,
        createdBy: admin?.userId,
      });
    });
  }
  async resetPassword(secret: string, password: string) {
    this.challenge(secret, "reset");
    const encoded = await passwordHash(password);
    return this.tx(() => {
      const c = this.challenge(secret, "reset");
      const user = this.user(String(c.user_id));
      this.db
        .prepare("UPDATE web_users SET password_hash=? WHERE user_id=?")
        .run(encoded, user.userId);
      this.invalidateUser(user);
      this.db
        .prepare("UPDATE web_challenges SET consumed_at=? WHERE challenge_id=?")
        .run(now(), String(c.challenge_id));
      return this.newSession(user.userId);
    });
  }
  private invalidateUser(user: WebUser) {
    this.db
      .prepare("DELETE FROM web_sessions WHERE user_id=?")
      .run(user.userId);
    this.db
      .prepare(
        "UPDATE tokens SET revoked_at=? WHERE actor_id=? AND revoked_at IS NULL",
      )
      .run(now(), user.actorId);
    this.db
      .prepare(
        "UPDATE web_device_requests SET denied_at=? WHERE approved_by=? AND consumed_at IS NULL",
      )
      .run(now(), user.userId);
  }
  updateUser(
    admin: WebUser,
    userId: string,
    input: { role?: "admin" | "member"; disabled?: boolean },
  ) {
    this.requireAdmin(admin);
    return this.tx(() => {
      const target = this.users().find((u) => u.userId === userId);
      if (!target) return deny(404, "not_found", "Member not found.");
      if (
        target.role === "admin" &&
        !target.disabledAt &&
        (input.role === "member" || input.disabled)
      ) {
        const count = Number(
          this.db
            .prepare(
              "SELECT COUNT(*) AS n FROM web_users WHERE role='admin' AND disabled_at IS NULL",
            )
            .get()!.n,
        );
        if (count <= 1)
          return deny(409, "last_admin", "Keep at least one active admin.");
      }
      this.db
        .prepare("UPDATE web_users SET role=?,disabled_at=? WHERE user_id=?")
        .run(
          input.role ?? target.role,
          input.disabled === undefined
            ? target.disabledAt
            : input.disabled
              ? now()
              : null,
          userId,
        );
      if (input.disabled || input.role === "member") {
        this.invalidateUser(target);
        this.db
          .prepare(
            "UPDATE web_challenges SET revoked_at=? WHERE created_by=? AND consumed_at IS NULL",
          )
          .run(now(), target.userId);
      }
    });
  }
  beginDevice(label: string) {
    if (this.setupRequired())
      return deny(409, "setup_required", "An admin must finish setup first.");
    const deviceCode = token("psd");
    const raw = randomBytes(5).toString("hex").toUpperCase();
    const userCode = `${raw.slice(0, 5)}-${raw.slice(5)}`;
    const expiresAt = future(10 * 60_000);
    this.db
      .prepare("DELETE FROM web_device_requests WHERE expires_at<?")
      .run(new Date(Date.now() - 86_400_000).toISOString());
    this.db
      .prepare(
        "INSERT INTO web_device_requests(request_id,secret_hash,user_code,label,created_at,expires_at) VALUES(?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        digest(deviceCode),
        userCode,
        z.string().trim().min(1).max(80).parse(label),
        now(),
        expiresAt,
      );
    return { deviceCode, userCode, expiresAt, intervalSeconds: 3 };
  }
  deviceRequest(userCode: string) {
    const row = this.db
      .prepare(
        "SELECT user_code AS userCode,label,created_at AS createdAt,expires_at AS expiresAt,approved_by AS approvedBy,denied_at AS deniedAt,consumed_at AS consumedAt FROM web_device_requests WHERE user_code=? AND expires_at>?",
      )
      .get(userCode.toUpperCase(), now());
    if (!row || row.consumedAt)
      return deny(
        404,
        "device_not_found",
        "This device code expired or has already been used.",
      );
    return row;
  }
  approveDevice(user: WebUser, userCode: string, approve: boolean) {
    this.user(user.userId);
    return this.tx(() => {
      const row = this.deviceRequest(userCode);
      if (row.approvedBy || row.deniedAt)
        return deny(
          409,
          "device_decided",
          "This request has already been handled.",
        );
      this.db
        .prepare(
          "UPDATE web_device_requests SET approved_by=?,denied_at=? WHERE user_code=?",
        )
        .run(
          approve ? user.userId : null,
          approve ? null : now(),
          userCode.toUpperCase(),
        );
    });
  }
  pollDevice(secret: string) {
    if (!/^psd_[a-f0-9]{64}$/.test(secret))
      return deny(400, "device_expired", "Restart device registration.");
    return this.tx(() => {
      const r = this.db
        .prepare(
          "SELECT * FROM web_device_requests WHERE secret_hash=? AND expires_at>?",
        )
        .get(digest(secret), now());
      if (!r || r.consumed_at)
        return deny(
          400,
          "device_expired",
          "Device registration expired or was already completed.",
        );
      if (r.denied_at)
        return deny(403, "device_denied", "Device registration was denied.");
      if (r.last_poll_at && Date.now() - Number(r.last_poll_at) < 2000)
        return { status: "slow_down" as const };
      this.db
        .prepare(
          "UPDATE web_device_requests SET last_poll_at=? WHERE request_id=?",
        )
        .run(Date.now(), r.request_id!);
      if (!r.approved_by) return { status: "pending" as const };
      const user = this.user(String(r.approved_by));
      const credential = this.registry.grant(user.actorId);
      this.db
        .prepare(
          "INSERT INTO web_device_tokens(token_id,user_id,label) VALUES(?,?,?)",
        )
        .run(credential.tokenId, user.userId, r.label!);
      this.db
        .prepare(
          "UPDATE web_device_requests SET consumed_at=? WHERE request_id=?",
        )
        .run(now(), r.request_id!);
      return { status: "approved" as const, credential };
    });
  }
  devices(user: WebUser) {
    return this.db
      .prepare(
        `SELECT t.token_id AS tokenId,COALESCE(d.label,'CLI credential') AS label,t.created_at AS createdAt,t.expires_at AS expiresAt,t.revoked_at AS revokedAt,d.last_used_at AS lastUsedAt,s.synced_at AS syncedAt,s.body AS syncBody
      FROM tokens t LEFT JOIN web_device_tokens d ON d.token_id=t.token_id LEFT JOIN device_sync s ON s.token_id=t.token_id WHERE t.actor_id=? ORDER BY t.created_at DESC`,
      )
      .all(user.actorId)
      .map(({ syncBody, ...row }) => ({
        ...row,
        sync: syncBody ? JSON.parse(String(syncBody)) : null,
      }));
  }
  revokeDevice(user: WebUser, tokenId: string) {
    const row = this.db
      .prepare("SELECT actor_id FROM tokens WHERE token_id=?")
      .get(tokenId);
    if (!row || (row.actor_id !== user.actorId && user.role !== "admin"))
      return deny(403, "device_forbidden", "You cannot revoke this device.");
    this.registry.revoke(tokenId);
  }
}
