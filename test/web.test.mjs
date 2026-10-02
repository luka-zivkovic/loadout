import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { Registry, serveRegistry } from "../dist/registry.js";
import { WebAuth, migrateWebAuth } from "../dist/web-auth.js";
import { publicOrigin, registrationInstructions } from "../dist/web-server.js";
import { connectTeam, TeamClient } from "../dist/team-client.js";
import { Store } from "../dist/store.js";
import { Collector } from "../dist/metrics.js";
import { digest } from "../dist/files.js";
import { exampleProfile } from "../dist/profiles.js";
import { sealSkill } from "../dist/skills.js";
import { addSkillToSetup, sealNativeSetup } from "../dist/setups.js";
import { packFile } from "../dist/files.js";
import { NativeTelemetry } from "../dist/telemetry.js";

const password = "fixture-password-long-enough";
const adminInput = {
  name: "First Admin",
  email: "admin@example.test",
  actorId: "admin",
  password,
};
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pi-share-web-"));
  const registry = new Registry(join(dir, "registry"), {
    teamName: "engineering",
    scope: "work",
  });
  const auth = new WebAuth(registry);
  const running = await serveRegistry(registry, { port: 0, ...options });
  const url = `http://127.0.0.1:${running.port}`;
  const origin = running.origin;
  t.after(async () => {
    await running.close();
    registry.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function call(path, body, session, headers = {}) {
    return new Promise((resolve, reject) => {
      const request = httpRequest(
        url + path,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Host: new URL(origin).host,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json", Origin: origin }),
            ...(session
              ? {
                  Cookie: `pi_share_session=${session.sessionToken}`,
                  "X-CSRF-Token": session.csrf,
                }
              : {}),
            ...headers,
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            try {
              const resultHeaders = new Headers();
              for (const [key, value] of Object.entries(response.headers)) {
                if (value !== undefined)
                  resultHeaders.set(
                    key,
                    Array.isArray(value) ? value.join(",") : value,
                  );
              }
              resolve({
                status: response.statusCode,
                headers: resultHeaders,
                value: JSON.parse(Buffer.concat(chunks).toString()),
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on("error", reject);
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  async function firstAdmin() {
    const c = auth.issueSetup();
    return auth.setup({ ...adminInput, token: c.token });
  }
  async function member(admin, name = "member", role = "member") {
    const invitation = auth.invite(admin.user, {
      email: `${name}@example.test`,
      actorId: name,
      role,
    });
    return auth.join({ token: invitation.token, name, password });
  }
  return {
    dir,
    registry,
    auth,
    running,
    url,
    origin,
    call,
    firstAdmin,
    member,
  };
}
function record(actor = "admin", mode = "live") {
  const profile = exampleProfile("review", "work", "fixture/local");
  const collector = new Collector(
    {
      runId: randomUUID(),
      comparisonId: randomUUID(),
      scope: "work",
      actorId: actor,
      deviceId: randomUUID(),
      profileName: profile.name,
      profileRevision: profile.revision,
      effectiveConfigHash: digest("effective"),
      contextHash: digest("frozen-code-context"),
      workflowId: profile.workflow.id,
      mode,
      source: "runner",
      piVersion: "0.85.1",
      toolPolicy: "profile",
    },
    ".",
  );
  collector.observe({
    type: "message_end",
    message: {
      role: "assistant",
      provider: "fixture",
      model: "local",
      stopReason: "stop",
      content: [{ type: "text", text: "PRIVATE_CONVERSATION_SENTINEL" }],
      usage: {
        input: 50,
        output: 12,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { total: 0.01 },
      },
    },
  });
  return collector.finish();
}
const outcome = {
  validFindings: 2,
  falsePositives: 1,
  missedKnownIssues: 0,
  evaluator: "human",
};

test("web auth migration adds optional people-directory profile fields", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE tokens (token_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL);
    CREATE TABLE web_users (
      user_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL,
      disabled_at TEXT, created_at TEXT NOT NULL
    );
  `);
  migrateWebAuth(db);
  const columns = db
    .prepare("PRAGMA table_info(web_users)")
    .all()
    .map((column) => column.name);
  assert(columns.includes("job_title"));
  assert(columns.includes("company_team"));
  db.close();
});

test("members maintain their own profile and discover active colleagues", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const member = await f.member(admin, "sam");
  const colleague = await f.member(admin, "alex");

  assert.equal((await f.call("/api/people")).status, 401);
  assert.equal(
    (
      await f.call(
        "/api/profile",
        {
          jobTitle: " Staff engineer ",
          companyTeam: " Platform ",
          userId: admin.user.userId,
        },
        member,
      )
    ).status,
    400,
  );

  const updated = await f.call(
    "/api/profile",
    { jobTitle: " Staff engineer ", companyTeam: " Platform " },
    member,
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.value.user.jobTitle, "Staff engineer");
  assert.equal(updated.value.user.companyTeam, "Platform");

  const canonical = await f.call(
    "/api/profile",
    { jobTitle: "Engineering manager", companyTeam: "platform" },
    colleague,
  );
  assert.equal(canonical.status, 200);
  assert.equal(canonical.value.user.companyTeam, "Platform");

  const directory = await f.call("/api/people", undefined, member);
  assert.equal(directory.status, 200);
  assert.deepEqual(
    directory.value.people.map((person) => person.actorId),
    ["alex", "admin", "sam"],
  );
  assert.deepEqual(directory.value.teams, ["Platform"]);
  assert.equal(directory.value.people[0].email, undefined);
  assert.equal(directory.value.people[0].role, undefined);
  assert.equal(directory.value.people[0].userId, undefined);
  assert.equal(
    directory.value.people.find((person) => person.actorId === "sam").jobTitle,
    "Staff engineer",
  );

  assert.equal(
    (
      await f.call(
        "/api/admin/users",
        { userId: member.user.userId, jobTitle: "Changed by admin" },
        admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/api/admin/users",
        { userId: colleague.user.userId, disabled: true },
        admin,
      )
    ).status,
    200,
  );
  const afterDisable = await f.call("/api/people", undefined, member);
  assert.deepEqual(
    afterDisable.value.people.map((person) => person.actorId),
    ["admin", "sam"],
  );
});

test("skill requests support anonymous discussion, interest, and moderation", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const author = await f.member(admin, "alice");
  const colleague = await f.member(admin, "bob");
  const path = "/api/skill-requests";

  assert.equal((await f.call(path)).status, 401);
  assert.equal(
    (await f.call(path, { title: "A useful skill", body: "Help with recurring reviews", anonymous: true }, author, { "X-CSRF-Token": "" })).status,
    403,
  );
  assert.equal(
    (await f.call(path, { title: "Short", body: "tiny", anonymous: true }, author)).status,
    400,
  );
  const created = await f.call(
    path,
    {
      title: "Review migrations before deploy",
      body: "Check schema changes for safe rollout and rollback steps.",
      anonymous: true,
    },
    author,
  );
  assert.equal(created.status, 200);
  const id = created.value.request.id;
  assert.equal(created.value.request.mine, true);
  assert.equal(created.value.request.author, "Anonymous");

  const listed = await f.call(path, undefined, colleague);
  assert.equal(listed.value.requests.length, 1);
  assert.equal(listed.value.requests[0].author, "Anonymous");
  assert.equal(listed.value.requests[0].mine, false);
  assert.equal(listed.value.requests[0].moderatorAuthor, undefined);
  assert.equal(JSON.stringify(listed.value).includes("alice"), false);
  const adminList = await f.call(path, undefined, admin);
  assert.equal(adminList.value.requests[0].moderatorAuthor, "alice");

  for (let i = 0; i < 2; i++) {
    const vote = await f.call(`${path}/${id}/interest`, { interested: true }, colleague);
    assert.equal(vote.status, 200);
    assert.equal(vote.value.request.interestCount, 1);
    assert.equal(vote.value.request.interested, true);
  }
  const unvote = await f.call(`${path}/${id}/interest`, { interested: false }, colleague);
  assert.equal(unvote.status, 200);
  assert.equal(unvote.value.request.interestCount, 0);
  assert.equal(unvote.value.request.interested, false);
  const comment = await f.call(
    `${path}/${id}/comments`,
    { body: "We also need to check backward compatibility.", anonymous: true },
    colleague,
  );
  assert.equal(comment.status, 200);
  const commentId = comment.value.request.comments[0].id;
  assert.equal(comment.value.request.commentCount, 1);
  const authorDetail = await f.call(`${path}/${id}`, undefined, author);
  assert.equal(authorDetail.value.request.comments[0].author, "Anonymous");
  assert.equal(authorDetail.value.request.comments[0].moderatorAuthor, undefined);
  assert.equal(JSON.stringify(authorDetail.value).includes("bob"), false);
  const adminDetail = await f.call(`${path}/${id}`, undefined, admin);
  assert.equal(adminDetail.value.request.comments[0].moderatorAuthor, "bob");

  assert.equal(
    (await f.call(`${path}/${id}/comments/${commentId}/hide`, {}, author)).status,
    403,
  );
  assert.equal(
    (await f.call(`${path}/${id}/comments/${commentId}/hide`, {}, admin)).status,
    200,
  );
  assert.equal(
    (await f.call(`${path}/${id}`, undefined, colleague)).value.request.commentCount,
    0,
  );
  assert.equal((await f.call(`${path}/${id}/archive`, {}, colleague)).status, 403);
  assert.equal((await f.call(`${path}/${id}/archive`, {}, author)).status, 200);
  assert.equal((await f.call(path, undefined, author)).value.requests.length, 0);
  assert.ok((await f.call(`${path}/${id}`, undefined, admin)).value.request.archivedAt);
  assert.equal(
    (await f.call(`${path}/${id}/comments`, { body: "Later", anonymous: false }, colleague)).status,
    409,
  );
});

test("skill request and discussion pages stay bounded and complete", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const member = await f.member(admin, "requester");
  const path = "/api/skill-requests";
  const created = [];
  for (let i = 0; i < 25; i++) {
    const result = f.registry.ops.createSkillRequest(member.user.actorId, {
      title: `Skill idea number ${i}`,
      body: `A reusable workflow for scenario ${i}.`,
      anonymous: false,
    });
    created.push(result.id);
  }
  const first = await f.call(path, undefined, member);
  assert.equal(first.status, 200);
  assert.equal(first.value.total, 25);
  assert.equal(first.value.requests.length, 20);
  assert(first.value.nextCursor);
  const second = await f.call(`${path}?cursor=${encodeURIComponent(first.value.nextCursor)}`, undefined, member);
  assert.equal(second.status, 200);
  assert.equal(second.value.requests.length, 5);
  assert.equal(second.value.nextCursor, null);
  assert.equal(new Set([...first.value.requests, ...second.value.requests].map((request) => request.id)).size, 25);
  assert.equal((await f.call(`${path}?cursor=invalid`, undefined, member)).status, 400);

  const requestId = created[0];
  for (let i = 0; i < 35; i++)
    f.registry.ops.commentOnSkillRequest(member.user.actorId, requestId, {
      body: `Comment number ${i}`,
      anonymous: false,
    });
  const detail = await f.call(`${path}/${requestId}`, undefined, member);
  assert.equal(detail.status, 200);
  assert.equal(detail.value.request.commentCount, 35);
  assert.equal(detail.value.request.comments.length, 30);
  assert(detail.value.request.nextCommentCursor);
  const older = await f.call(
    `${path}/${requestId}?cursor=${encodeURIComponent(detail.value.request.nextCommentCursor)}`,
    undefined,
    member,
  );
  assert.equal(older.status, 200);
  assert.equal(older.value.request.comments.length, 5);
  assert.equal(older.value.request.nextCommentCursor, null);
  assert.equal(
    new Set([...detail.value.request.comments, ...older.value.request.comments].map((comment) => comment.id)).size,
    35,
  );
  assert.equal((await f.call(`${path}/${requestId}?cursor=invalid`, undefined, member)).status, 400);
});

test("first admin requires a host-issued key, normalizes identity, and can be claimed only once", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call("/api/session")).value.setupRequired, true);
  assert.equal(
    (
      await f.call("/api/auth/setup", {
        ...adminInput,
        token: "psb_" + "0".repeat(64),
      })
    ).status,
    400,
  );
  const obsolete = f.auth.issueSetup();
  const challenge = f.auth.issueSetup();
  assert.equal(
    (await f.call("/api/auth/setup", { ...adminInput, token: obsolete.token }))
      .status,
    400,
  );
  const attempts = await Promise.allSettled([
    f.auth.setup({
      ...adminInput,
      email: " ADMIN@EXAMPLE.TEST ",
      token: challenge.token,
    }),
    f.auth.setup({ ...adminInput, token: challenge.token }),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(f.auth.users().length, 1);
  assert.equal(f.auth.users()[0].email, "admin@example.test");
  assert.equal(f.auth.users()[0].role, "admin");
  assert.equal(f.auth.setupRequired(), false);
  assert.throws(() => f.auth.issueSetup(), /already been created/);
  assert.equal(
    (await f.call("/api/auth/setup", { ...adminInput, token: challenge.token }))
      .status,
    400,
  );
  const hashes = f.registry.db
    .prepare("SELECT password_hash FROM web_users")
    .get();
  assert.match(hashes.password_hash, /^scrypt:131072:8:1:/);
  assert(!hashes.password_hash.includes(password));
  assert.equal(
    f.registry.db
      .prepare("SELECT token_hash FROM web_challenges WHERE challenge_id=?")
      .get(challenge.challengeId).token_hash,
    digest(challenge.token),
  );
  assert.equal((await f.call("/api/auth/signup", adminInput)).status, 401);
});

test("browser sessions use secure cookies, require Origin and CSRF, expire and log out", async (t) => {
  const f = await fixture(t, { publicUrl: "https://share.example.test" });
  const challenge = f.auth.issueSetup();
  const setup = await f.call("/api/auth/setup", {
    ...adminInput,
    token: challenge.token,
  });
  assert.equal(setup.status, 200);
  const setCookie = setup.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /Max-Age=604800/);
  assert(!("sessionToken" in setup.value));
  const session = {
    ...setup.value,
    sessionToken: setCookie.split(";")[0].split("=")[1],
  };
  assert.equal(
    (await f.call("/api/admin/team", undefined, session)).status,
    200,
  );
  assert.equal(
    (
      await f.call(
        "/api/admin/invitations",
        { email: "x@example.test", actorId: "x", role: "member" },
        session,
        { "X-CSRF-Token": "bad" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("/api/auth/logout", {}, session, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call("/api/auth/logout", {}, session, { Origin: "" })).status,
    403,
  );
  assert.equal(
    (
      await f.call("/api/session", undefined, undefined, {
        Host: "evil.example",
      })
    ).status,
    403,
  );
  assert.equal((await f.call("/api/auth/logout", {}, session)).status, 200);
  assert.equal(
    (await f.call("/api/dashboard", undefined, session)).status,
    401,
  );
  const fresh = await f.auth.login(adminInput.email, password);
  f.registry.db
    .prepare("UPDATE web_sessions SET expires_at=?")
    .run("2000-01-01T00:00:00.000Z");
  assert.equal(
    (await f.call("/api/session", undefined, fresh)).value.user,
    null,
  );
  assert.throws(() => publicOrigin("http://public.example"), /HTTPS/);
  assert.throws(
    () => publicOrigin("https://user:pass@example.test"),
    /without credentials/,
  );
});

test("admin invitations bind identity and role, reject replay, revocation, expiry, and duplicate recipients", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const invite = await f.call(
    "/api/admin/invitations",
    { email: " Invited@Example.Test ", actorId: "invited", role: "member" },
    admin,
  );
  assert.equal(invite.status, 201);
  assert.match(invite.value.url, /\/join#token=/);
  const info = await f.call("/api/auth/challenge", {
    token: invite.value.token,
    kind: "invite",
  });
  assert.equal(info.value.email, "invited@example.test");
  assert.equal(
    (
      await f.call("/api/auth/join", {
        token: invite.value.token,
        name: "Invited",
        password,
        role: "admin",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(
        "/api/admin/invitations",
        { email: "invited@example.test", actorId: "different", role: "admin" },
        admin,
      )
    ).status,
    409,
  );
  const joined = await f.call("/api/auth/join", {
    token: invite.value.token,
    name: "Invited",
    password,
  });
  assert.equal(joined.status, 200);
  assert.equal(joined.value.user.role, "member");
  assert.equal(joined.value.user.actorId, "invited");
  assert.equal(
    (
      await f.call("/api/auth/join", {
        token: invite.value.token,
        name: "Again",
        password,
      })
    ).status,
    400,
  );
  const member = await f.auth.login("invited@example.test", password);
  assert.equal(
    (await f.call("/api/admin/team", undefined, member)).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        "/api/admin/invitations",
        { email: "attack@example.test", actorId: "attack", role: "admin" },
        member,
      )
    ).status,
    403,
  );
  const revoked = f.auth.invite(admin.user, {
    email: "revoked@example.test",
    actorId: "revoked",
    role: "member",
  });
  f.auth.revokeInvitation(admin.user, revoked.challengeId);
  await assert.rejects(
    () => f.auth.join({ token: revoked.token, name: "Revoked", password }),
    /invalid, expired, or already used/,
  );
  const expired = f.auth.invite(admin.user, {
    email: "expired@example.test",
    actorId: "expired",
    role: "member",
  });
  f.registry.db
    .prepare("UPDATE web_challenges SET expires_at=? WHERE challenge_id=?")
    .run("2000-01-01T00:00:00.000Z", expired.challengeId);
  await assert.rejects(
    () => f.auth.join({ token: expired.token, name: "Expired", password }),
    /invalid, expired, or already used/,
  );
  const pending = await f.call("/api/admin/team", undefined, admin);
  assert(!JSON.stringify(pending.value).includes("token_hash"));
  assert(!JSON.stringify(pending.value).includes(invite.value.token));
});

test("members create expiring multi-use links and teammates can join concurrently", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const alice = await f.member(admin, "alice");
  const bob = await f.member(admin, "bob");
  const expiresAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  assert.equal((await f.call("/api/invite-links")).status, 401);
  assert.equal((await f.call("/api/invite-links", { expiresAt }, alice, { "X-CSRF-Token": "" })).status, 403);
  assert.equal((await f.call("/api/invite-links", { expiresAt: new Date(Date.now() + 2 * 60_000).toISOString() }, alice)).status, 400);
  assert.equal((await f.call("/api/invite-links", { expiresAt: new Date(Date.now() + 31 * 86_400_000).toISOString() }, alice)).status, 400);
  const created = await f.call("/api/invite-links", { expiresAt }, alice);
  assert.equal(created.status, 201);
  assert.match(created.value.url, /\/join#token=psl_[a-f0-9]{64}$/);
  const info = await f.call("/api/auth/challenge", { token: created.value.token, kind: "invite" });
  assert.equal(info.value.multiUse, true);
  assert.equal(info.value.role, "member");
  assert.equal(info.value.email, null);
  const own = await f.call("/api/invite-links", undefined, alice);
  assert.equal(own.value.links.length, 1);
  assert.equal(own.value.links[0].useCount, 0);
  assert(!JSON.stringify(own.value).includes(created.value.token));
  assert(!JSON.stringify(own.value).includes("token_hash"));
  assert.equal((await f.call("/api/invite-links", undefined, bob)).value.links.length, 0);
  assert.equal((await f.call("/api/invite-links", undefined, admin)).value.links.length, 1);
  assert.equal((await f.call("/api/auth/join", { token: created.value.token, name: "No email", password })).status, 400);
  assert.equal((await f.call("/api/auth/join", { token: created.value.token, name: "Escalate", email: "bad@example.test", actorId: "bad", password, role: "admin" })).status, 400);
  const joined = await Promise.all([
    f.call("/api/auth/join", { token: created.value.token, name: "Charlie", email: "Charlie@Example.Test", actorId: "charlie", password }),
    f.call("/api/auth/join", { token: created.value.token, name: "Dana", email: "dana@example.test", actorId: "dana", password }),
  ]);
  assert.deepEqual(joined.map((r) => r.status), [200, 200]);
  assert.deepEqual(joined.map((r) => r.value.user.role), ["member", "member"]);
  assert.equal(joined[0].value.user.email, "charlie@example.test");
  assert.equal((await f.call("/api/invite-links", undefined, alice)).value.links[0].useCount, 2);
  assert.equal((await f.call("/api/invite-links/revoke", { linkId: created.value.linkId }, bob)).status, 403);
  assert.equal((await f.call("/api/invite-links/revoke", { linkId: created.value.linkId }, alice)).status, 200);
  assert.equal((await f.call("/api/auth/challenge", { token: created.value.token, kind: "invite" })).status, 400);
  assert.equal((await f.call("/api/auth/join", { token: created.value.token, name: "Later", email: "later@example.test", actorId: "later", password })).status, 400);
});

test("admins can revoke member links; expired and disabled-issuer links cannot be used", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const alice = await f.member(admin, "alice");
  const make = () => f.call("/api/invite-links", { expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, alice);
  const expired = await make();
  f.registry.db.prepare("UPDATE web_invite_links SET expires_at=? WHERE link_id=?")
    .run("2000-01-01T00:00:00.000Z", expired.value.linkId);
  assert.equal((await f.call("/api/auth/challenge", { token: expired.value.token, kind: "invite" })).status, 400);
  const revoked = await make();
  assert.equal((await f.call("/api/invite-links/revoke", { linkId: revoked.value.linkId }, admin)).status, 200);
  assert.equal((await f.call("/api/auth/challenge", { token: revoked.value.token, kind: "invite" })).status, 400);
  const disabled = await make();
  f.auth.updateUser(admin.user, alice.user.userId, { disabled: true });
  assert.equal((await f.call("/api/auth/challenge", { token: disabled.value.token, kind: "invite" })).status, 400);
  assert.equal((await f.call("/api/invite-links", undefined, alice)).status, 401);
});

test("concurrent invitation redemption creates one account; issuer removal invalidates outstanding links", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const second = await f.member(admin, "second", "admin");
  const invite = f.auth.invite(second.user, {
    email: "racer@example.test",
    actorId: "racer",
    role: "member",
  });
  const results = await Promise.allSettled([
    f.auth.join({ token: invite.token, name: "Race A", password }),
    f.auth.join({ token: invite.token, name: "Race B", password }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const stale = f.auth.invite(second.user, {
    email: "stale@example.test",
    actorId: "stale",
    role: "admin",
  });
  f.auth.updateUser(admin.user, second.user.userId, { role: "member" });
  await assert.rejects(
    () => f.auth.join({ token: stale.token, name: "Stale", password }),
    /invalid, expired, or already used/,
  );
  assert.equal(
    (await f.call("/api/admin/team", undefined, second)).status,
    401,
  );
});

test("last-admin guard and account disabling revoke browser sessions, devices, and legacy credentials", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const member = await f.member(admin);
  for (const change of [{ role: "member" }, { disabled: true }])
    assert.equal(
      (
        await f.call(
          "/api/admin/users",
          { userId: admin.user.userId, ...change },
          admin,
        )
      ).status,
      409,
    );
  const legacy = f.registry.grant(member.user.actorId);
  const request = f.auth.beginDevice("Member laptop");
  f.auth.approveDevice(member.user, request.userCode, true);
  const grant = f.auth.pollDevice(request.deviceCode);
  assert.equal(f.registry.authenticate(legacy.token).actorId, "member");
  assert.equal(
    f.registry.authenticate(grant.credential.token).actorId,
    "member",
  );
  const pending = f.auth.beginDevice("Pending laptop");
  f.auth.approveDevice(member.user, pending.userCode, true);
  assert.equal(
    (
      await f.call(
        "/api/admin/users",
        { userId: member.user.userId, disabled: true },
        admin,
      )
    ).status,
    200,
  );
  assert.equal((await f.call("/api/dashboard", undefined, member)).status, 401);
  assert.throws(
    () => f.registry.authenticate(legacy.token),
    /expired, revoked, or invalid/,
  );
  assert.throws(
    () => f.registry.authenticate(grant.credential.token),
    /expired, revoked, or invalid/,
  );
  assert.throws(() => f.auth.pollDevice(pending.deviceCode), /denied/);
  await assert.rejects(
    () => f.auth.login("member@example.test", password),
    /incorrect/,
  );
  f.auth.updateUser(admin.user, member.user.userId, { disabled: false });
  assert((await f.auth.login("member@example.test", password)).user);
  assert.throws(
    () => f.registry.authenticate(legacy.token),
    /expired, revoked, or invalid/,
  );
});

test("device pairing needs human session approval, grants only the approving account, and consumes once", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const member = await f.member(admin);
  const start = await fetch(f.url + "/v1/device/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label: "Work laptop" }),
  });
  const request = await start.json();
  assert.equal(start.status, 200);
  assert.equal(request.team.scope, "work");
  assert(!("credential" in request));
  assert.equal(
    (await f.call("/v1/device/start", { label: "Browser attempt" }, admin))
      .status,
    403,
  );
  assert.equal(
    (await f.call("/api/devices/inspect", { code: request.userCode })).status,
    401,
  );
  assert.equal(f.auth.pollDevice(request.deviceCode).status, "pending");
  assert.equal(f.auth.pollDevice(request.deviceCode).status, "slow_down");
  assert.equal(
    (await f.call("/api/devices/inspect", { code: request.userCode }, member))
      .value.label,
    "Work laptop",
  );
  const approved = await f.call(
    "/api/devices/approve",
    { code: request.userCode, approve: true },
    member,
  );
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.value, { ok: true });
  assert.equal(
    (
      await f.call(
        "/api/devices/approve",
        { code: request.userCode, approve: true },
        admin,
      )
    ).status,
    409,
  );
  f.registry.db.prepare("UPDATE web_device_requests SET last_poll_at=0").run();
  const grant = f.auth.pollDevice(request.deviceCode);
  assert.equal(grant.status, "approved");
  assert.equal(grant.credential.actorId, "member");
  assert.throws(
    () => f.auth.pollDevice(request.deviceCode),
    /already completed/,
  );
  const store = new Store(join(f.dir, "device"), "work");
  await connectTeam(store, "team", f.url, grant.credential);
  assert.equal(
    (await new TeamClient(store, "team").identity()).actorId,
    "member",
  );
  const devices = (await f.call("/api/devices", undefined, member)).value
    .devices;
  assert.equal(devices[0].label, "Work laptop");
  assert(devices[0].lastUsedAt);
  assert(!JSON.stringify(devices).includes(grant.credential.token));
  assert.equal(
    (await f.call("/api/devices", undefined, admin)).value.devices.length,
    0,
  );
  const adminToken = f.registry.grant("admin");
  assert.equal(
    (
      await f.call(
        "/api/devices/revoke",
        { tokenId: adminToken.tokenId },
        member,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        "/api/devices/revoke",
        { tokenId: grant.credential.tokenId },
        member,
      )
    ).status,
    200,
  );
  await assert.rejects(
    () => new TeamClient(store, "team").identity(),
    /expired, revoked, or invalid/,
  );
  const denied = f.auth.beginDevice("Denied");
  f.auth.approveDevice(member.user, denied.userCode, false);
  assert.throws(() => f.auth.pollDevice(denied.deviceCode), /denied/);
  const expired = f.auth.beginDevice("Expired");
  f.registry.db
    .prepare("UPDATE web_device_requests SET expires_at=? WHERE user_code=?")
    .run("2000-01-01T00:00:00.000Z", expired.userCode);
  assert.throws(() => f.auth.pollDevice(expired.deviceCode), /expired/);
});

test("password reset links are single-use, expire, replace passwords, and revoke all prior access", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const member = await f.member(admin);
  const credential = f.registry.grant("member");
  assert.equal(
    (
      await f.call(
        "/api/admin/reset-link",
        { userId: admin.user.userId },
        member,
      )
    ).status,
    403,
  );
  const reset = await f.call(
    "/api/admin/reset-link",
    { userId: member.user.userId },
    admin,
  );
  assert.equal(reset.status, 201);
  assert.match(reset.value.url, /\/reset#token=/);
  const changed = await f.call("/api/auth/reset", {
    token: reset.value.token,
    password: "changed-fixture-password",
  });
  assert.equal(changed.status, 200);
  assert.equal((await f.call("/api/dashboard", undefined, member)).status, 401);
  assert.throws(
    () => f.registry.authenticate(credential.token),
    /expired, revoked, or invalid/,
  );
  await assert.rejects(
    () => f.auth.login("member@example.test", password),
    /incorrect/,
  );
  assert(
    (await f.auth.login("member@example.test", "changed-fixture-password"))
      .user,
  );
  assert.equal(
    (await f.call("/api/auth/reset", { token: reset.value.token, password }))
      .status,
    400,
  );
  const expired = f.auth.resetLink(member.user.userId, admin.user);
  f.registry.db
    .prepare("UPDATE web_challenges SET expires_at=? WHERE challenge_id=?")
    .run("2000-01-01T00:00:00.000Z", expired.challengeId);
  await assert.rejects(
    () => f.auth.resetPassword(expired.token, password),
    /invalid, expired, or already used/,
  );
  const cli = spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      "registry",
      "recovery-link",
      "--data",
      join(f.dir, "registry"),
      "--email",
      adminInput.email,
      "--public-url",
      f.origin,
    ],
    { cwd: resolve("."), encoding: "utf8" },
  );
  assert.equal(cli.status, 0, cli.stderr);
  const path = join(f.dir, "registry/reset-link.txt");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const link = readFileSync(path, "utf8").trim();
  assert(!cli.stdout.includes(new URL(link).hash));
  assert(
    (
      await f.auth.resetPassword(
        new URLSearchParams(new URL(link).hash.slice(1)).get("token"),
        "recovered-fixture-password",
      )
    ).user.role === "admin",
  );
});

test("dashboard serves private metadata, separates demo data, exposes scores, and serves the built SPA", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const member = await f.member(admin);
  const profile = exampleProfile("review", "work", "fixture/local");
  f.registry.publish("admin", profile, null);
  const live = record();
  const demo = record("admin", "demo");
  f.registry.putRuns("admin", [live, demo]);
  assert.equal((await f.call("/api/dashboard")).status, 401);
  const dashboard = await f.call(
    "/api/dashboard?mode=live&days=30",
    undefined,
    member,
  );
  assert.equal(dashboard.status, 200);
  assert.deepEqual(
    dashboard.value.records.map((r) => r.runId),
    [live.runId],
  );
  assert.equal(dashboard.value.profiles.length, 1);
  assert(
    !JSON.stringify(dashboard.value).includes("PRIVATE_CONVERSATION_SENTINEL"),
  );
  const demoDashboard = await f.call(
    "/api/dashboard?mode=demo&days=30",
    undefined,
    member,
  );
  assert.deepEqual(
    demoDashboard.value.records.map((r) => r.runId),
    [demo.runId],
  );
  const filteredDashboard = await f.call(
    "/api/dashboard?mode=demo&days=7&harness=codex",
    undefined,
    member,
  );
  assert.equal(filteredDashboard.value.records.length, 0);
  assert.equal(
    filteredDashboard.value.liveRunCount,
    1,
    "workspace readiness must ignore the current period, harness, and demo filters",
  );
  const setup = await f.call(
    `/api/setups/admin/review/${profile.revision}`,
    undefined,
    member,
  );
  assert.equal(setup.status, 200);
  assert.equal(setup.value.profile.workflow.prompt, profile.workflow.prompt);
  assert(setup.value.profile.files.every((f) => !("data" in f)));
  const score = await f.call(
    "/api/assessments",
    { runId: live.runId, parents: [], outcome },
    member,
  );
  assert.equal(score.status, 201);
  assert.equal(score.value.assessment.actorId, "member");
  assert.equal(
    (
      await f.call(
        "/api/assessments",
        { runId: live.runId, parents: [], outcome, actorId: "admin" },
        member,
      )
    ).status,
    400,
  );
  const conflict = await f.call(
    "/api/assessments",
    {
      runId: live.runId,
      parents: [],
      outcome: { ...outcome, validFindings: 3 },
    },
    member,
  );
  assert.equal(conflict.status, 201);
  assert.equal(
    (
      await f.call(
        "/api/assessments",
        {
          runId: live.runId,
          parents: [
            score.value.assessment.eventId,
            conflict.value.assessment.eventId,
          ],
          outcome,
        },
        member,
      )
    ).status,
    201,
  );
  assert.equal(
    (await f.call("/api/dashboard", undefined, member)).value.assessments
      .length,
    3,
  );
  const instructions = (await f.call("/api/instructions", undefined, member))
    .value.instructions;
  assert.match(instructions, /team login engineering --scope work/);
  assert.match(instructions, /cursor, or opencode/);
  assert.match(instructions, /Cursor and OpenCode selected settings/);
  assert.match(instructions, /project or global rules and instructions, commands, agents, hooks, plugin and tool files, and skills/);
  assert.match(instructions, /MCP servers are shared by name only/);
  assert.match(instructions, /Never ask for my password/);
  assert(!/ps[bidrs]?_[a-f0-9]{64}/.test(instructions));
  for (const route of [
    "/",
    "/login",
    "/setup",
    "/join",
    "/reset",
    "/setups",
    "/skills",
    "/requests",
    "/people",
    "/activity",
    "/comparisons",
    "/devices",
    "/devices?connect=1",
    "/team",
    `/setups/admin/review/${profile.revision}`,
  ]) {
    const page = await fetch(f.url + route);
    assert.equal(page.status, 200, route);
    assert.match(await page.text(), /<title>Loadout/);
  }
  assert.equal((await fetch(f.url + "/missing-route")).status, 404);
  assert.equal((await fetch(f.url + "/assets/missing.js")).status, 404);
  const html = await fetch(f.url + "/comparisons");
  assert.equal(html.status, 200);
  assert.match(
    html.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.match(html.headers.get("content-security-policy"), /object-src 'none'/);
  assert.equal(html.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    html.headers.get("permissions-policy"),
    "camera=(), microphone=(), geolocation=()",
  );
  assert.equal(html.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(html.headers.get("cross-origin-resource-policy"), "same-origin");
  const content = await html.text();
  assert.match(content, /<title>Loadout/);
  const asset = content.match(/src="(\/assets\/[^" ]+\.js)"/)[1];
  const js = await fetch(f.url + asset);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type"), /javascript/);
  const stylesheet = content.match(/href="(\/assets\/[^" ]+\.css)"/)[1];
  const css = await (await fetch(f.url + stylesheet)).text();
  const fontPath = css.match(/url\((?:["'])?(\/assets\/[^)"']+\.woff2)/)[1];
  const font = await fetch(f.url + fontPath);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("content-type"), "font/woff2");
  assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString(), "wOF2");
  assert.equal(
    (
      await f.call("/api/auth/login", {
        email: adminInput.email,
        password: "x".repeat(17000),
      })
    ).status,
    413,
  );
});

test("session revocation is rechecked after receiving a pending write body", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const member = await f.member(admin);
  const live = record();
  f.registry.putRuns("admin", [live]);
  const body = JSON.stringify({ runId: live.runId, parents: [], outcome });
  const result = new Promise((resolve, reject) => {
    const req = httpRequest(
      f.url + "/api/assessments",
      {
        method: "POST",
        headers: {
          Origin: f.origin,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Cookie: `pi_share_session=${member.sessionToken}`,
          "X-CSRF-Token": member.csrf,
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      },
    );
    req.on("error", reject);
    req.write(body.slice(0, 10));
    void delay(30)
      .then(() => {
        f.auth.logout(digest(member.sessionToken));
        req.end(body.slice(10));
      })
      .catch(reject);
  });
  assert.equal(await result, 401);
  assert.equal(
    f.registry.db.prepare("SELECT COUNT(*) AS n FROM assessments").get().n,
    0,
  );
});

test("team login CLI completes browser-approved pairing without printing or requiring a credential", async (t) => {
  const f = await fixture(t);
  const admin = await f.firstAdmin();
  const member = await f.member(admin);
  const home = join(f.dir, "cli-home");
  const child = spawn(
    process.execPath,
    [
      "dist/cli.js",
      "team",
      "login",
      "team",
      "--home",
      home,
      "--scope",
      "work",
      "--url",
      f.url,
      "--label",
      "CLI test device",
    ],
    { cwd: resolve("."), stdio: ["ignore", "pipe", "pipe"] },
  );
  t.after(() => child.kill());
  let output = "";
  let errors = "";
  let approved = false;
  let approval;
  child.stdout.on("data", (chunk) => {
    output += chunk;
    const code = /Device code: ([A-F0-9]{5}-[A-F0-9]{5})/.exec(output)?.[1];
    if (code && !approved) {
      approved = true;
      approval = f.call(
        "/api/devices/approve",
        { code, approve: true },
        member,
      );
    }
  });
  child.stderr.on("data", (chunk) => (errors += chunk));
  const status = await Promise.race([
    new Promise((resolve) => child.on("exit", resolve)),
    delay(15000, undefined, { ref: false }).then(() => {
      throw new Error("Device login timed out");
    }),
  ]);
  assert.equal(status, 0, errors);
  assert.equal((await approval).status, 200);
  assert.match(output, /as member/);
  const path = join(home, "work/remotes/team/connection.json");
  const credential = JSON.parse(readFileSync(path));
  assert.equal(credential.actorId, "member");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert(!output.includes(credential.token));
  assert(!output.includes(password));
  assert.equal(
    (await new TeamClient(new Store(home, "work"), "team").identity()).actorId,
    "member",
  );
});

test("opening an existing registry upgrades account tables without losing v0.2 data", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-share-migrate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let registry = new Registry(dir, { teamName: "existing", scope: "work" });
  const credential = registry.grant("legacy");
  const profile = exampleProfile("review", "work", "fixture/local");
  registry.publish("legacy", profile, null);
  registry.putRuns("legacy", [record("legacy")]);
  for (const table of [
    "web_invite_links",
    "web_sessions",
    "web_challenges",
    "web_device_tokens",
    "web_device_requests",
    "web_users",
    "web_rate_limits",
  ])
    registry.db.exec(`DROP TABLE ${table}`);
  registry.close();
  registry = new Registry(dir);
  try {
    assert.equal(registry.authenticate(credential.token).actorId, "legacy");
    assert.equal(registry.profiles().length, 1);
    assert.equal(registry.changes(0, 100).changes.length, 2);
    assert(new WebAuth(registry).setupRequired());
  } finally {
    registry.close();
  }
});

test("authentication rate limits persist across connections and expire without storing raw identifiers", async (t) => {
  const f = await fixture(t);
  const bucket = "private-email@example.test";
  f.auth.rateLimit(bucket, 2, 60000);
  f.auth.rateLimit(bucket, 2, 60000);
  const connection = new Registry(join(f.dir, "registry"));
  try {
    assert.throws(
      () => new WebAuth(connection).rateLimit(bucket, 2, 60000),
      /Too many attempts/,
    );
  } finally {
    connection.close();
  }
  const rows = f.registry.db.prepare("SELECT * FROM web_rate_limits").all();
  assert(!JSON.stringify(rows).includes(bucket));
  f.registry.db.prepare("UPDATE web_rate_limits SET until_ms=0").run();
  assert.doesNotThrow(() => f.auth.rateLimit(bucket, 2, 60000));
  for (let i = 0; i < 30; i++)
    assert.equal(
      (
        await f.call("/api/auth/challenge", {
          token: "invalid",
          kind: "invite",
        })
      ).status,
      400,
    );
  assert.equal(
    (await f.call("/api/auth/challenge", { token: "invalid", kind: "invite" }))
      .status,
    429,
  );
});

test('shared skills and native setups are authenticated, previewable, and filtered by harness in analytics', async t => {
  const f = await fixture(t); const admin = await f.firstAdmin();
  const skill = sealSkill({ schemaVersion: 1, kind: 'skill', name: 'portable-review', scope: 'work', description: 'Reusable review guidance.', compatibleWith: ['pi', 'claude-code', 'codex'], requirements: [], files: [packFile('SKILL.md', Buffer.from('---\nname: portable-review\ndescription: Reusable review guidance.\n---\nCheck changed behavior.'))] });
  f.registry.publishSkill('admin', skill, null);
  const native = addSkillToSetup(sealNativeSetup({ schemaVersion: 2, kind: 'setup', name: 'native-review', scope: 'work', harness: { kind: 'codex', version: 'fixture' }, settings: { model: 'fixture' }, workflow: { id: 'pr-review', prompt: 'Review carefully.' }, resources: { skills: [], hooks: [], agents: [], prompts: [] }, instructions: [], files: [], skillPins: [], requirements: [], omittedSettings: [] }), skill);
  f.registry.publish('admin', native, null);
  const path = `/api/skills/admin/${skill.name}/${skill.revision}`;
  assert.equal((await f.call(path)).status, 401);
  const preview = await f.call(path, undefined, admin); assert.equal(preview.status, 200); assert.match(preview.value.instructions, /Check changed behavior/); assert(!('data' in preview.value.skill.files[0]));
  const setup = await f.call(`/api/setups/admin/${native.name}/${native.revision}`, undefined, admin); assert.equal(setup.value.profile.harness.kind, 'codex'); assert.equal(setup.value.profile.skillPins[0].revision, skill.revision);
  const store = new Store(join(f.dir, 'native'), 'work'); store.setActor('admin'); const collector = new NativeTelemetry(native, store);
  collector.consume({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ attributes: [{ key: 'event.name', value: { stringValue: 'codex.user_prompt' } }, { key: 'conversation.id', value: { stringValue: 'private-session' } }, { key: 'prompt', value: { stringValue: 'PRIVATE_WORK' } }] }] }] }] });
  f.registry.putRuns('admin', collector.records());
  const dashboard = await f.call('/api/dashboard?harness=codex', undefined, admin); assert.equal(dashboard.value.skills.length, 1); assert.equal(dashboard.value.records.length, 1); assert.equal(dashboard.value.records[0].status, 'recorded'); assert(!JSON.stringify(dashboard.value).includes('PRIVATE_WORK'));
  assert.equal((await f.call('/api/dashboard?harness=pi', undefined, admin)).value.records.length, 0);
  assert.equal((await f.call('/api/dashboard?harness=invalid', undefined, admin)).status, 400);
  assert.equal((await fetch(f.url + '/skills')).status, 200);
});

test('historical MCP definitions are names-only in browser previews and blocked from CLI download', async t => {
  const f = await fixture(t); const admin = await f.firstAdmin();
  const legacy = sealNativeSetup({ schemaVersion: 2, kind: 'setup', name: 'old-mcp', scope: 'work', harness: { kind: 'codex', version: 'fixture' }, settings: { mcp_servers: { docs: { command: 'node', args: ['--api-key', 'opaque-dummy-value-1234567890'] } } }, workflow: { id: 'review', prompt: 'Review.' }, resources: { skills: [], hooks: [], agents: [], prompts: [] }, instructions: [], files: [packFile('global/guide.md', Buffer.from('Safe guide'))], skillPins: [], requirements: [], omittedSettings: [] });
  f.registry.db.prepare('INSERT INTO blobs(revision,body) VALUES(?,?)').run(legacy.revision, JSON.stringify(legacy));
  f.registry.db.prepare('INSERT INTO profile_revisions(owner,name,revision,published_at) VALUES(?,?,?,?)').run('admin', legacy.name, legacy.revision, new Date().toISOString());
  const preview = await f.call(`/api/setups/admin/${legacy.name}/${legacy.revision}`, undefined, admin);
  assert.equal(preview.status, 200);
  assert.equal(preview.value.legacyMcpDetailsBlocked, true);
  assert.deepEqual(preview.value.profile.mcpServerNames, ['docs']);
  assert(!JSON.stringify(preview.value).includes('opaque-dummy-value'));
  assert(!JSON.stringify(preview.value).includes('command'));
  const file = await f.call(`/api/artifacts/profile/admin/${legacy.name}/${legacy.revision}/file?path=global%2Fguide.md`, undefined, admin);
  assert.equal(file.status, 410);
  const token = f.registry.grant('admin').token;
  const response = await fetch(`${f.url}/v1/profiles/admin/${legacy.name}/${legacy.revision}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 410);
});
