/* Pi Share — Dark Console prototype
   Plain-JS behaviour: hash routing, filters, search, inspect drawer,
   comparison modal, device pairing, invitations. All data below is SAMPLE
   DATA for design evaluation; nothing here is a measurement. */
(() => {
  "use strict";

  /* ------------------------------------------------------------------
     Sample data (fixed reference date so the prototype is stable)
     ------------------------------------------------------------------ */
  const NOW = Date.parse("2026-09-09T12:00:00Z");
  const DAY = 86400000;
  const ago = (days, hours = 0) => new Date(NOW - days * DAY - hours * 3600000).toISOString();

  const TEAM = { name: "acme-eng", scope: "reviews" };
  const ME = { name: "Alex Lindqvist", actorId: "alex", role: "admin" };

  const SETUPS = [
    {
      owner: "mira",
      name: "review-strict",
      revision: "3f9c2a7d1e8b40c6a5d2f1e0b9c8a7d6e5f4a3b2",
      provider: "anthropic",
      model: "claude-opus-5",
      thinking: "high",
      workflow: "code-review",
      piVersion: "0.31.2",
      skills: ["security-review", "test-discipline", "silent-failure-hunter"],
      extensions: ["lsp-bridge"],
      publishedAt: ago(0, 3),
      prompt:
        "Review the frozen packet as a senior reviewer. Report only findings you can point to in the diff. Rank by severity. Never propose fixes outside the changed files.",
      requirements: ["Node 22 or newer", "ripgrep on PATH"],
      files: [
        ["settings.json", "8a1f3c9e"],
        ["skills/security-review/SKILL.md", "c04d77b1"],
        ["extensions/lsp-bridge/index.ts", "5be2a9f0"],
      ],
    },
    {
      owner: "alex",
      name: "review-fast",
      revision: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      provider: "anthropic",
      model: "claude-sonnet-5",
      thinking: "medium",
      workflow: "code-review",
      piVersion: "0.31.2",
      skills: ["code-review", "test-discipline"],
      extensions: [],
      publishedAt: ago(1, 5),
      prompt:
        "Fast pass over the packet. Prefer precision over recall; flag anything that would fail CI or break an existing behavioural test.",
      requirements: ["Node 22 or newer"],
      files: [
        ["settings.json", "1c2d3e4f"],
        ["skills/code-review/SKILL.md", "9f8e7d6c"],
      ],
    },
    {
      owner: "sam",
      name: "migration-guard",
      revision: "77d0e9f1c2b3a4d5e6f708192a3b4c5d6e7f8091",
      provider: "openai",
      model: "gpt-5",
      thinking: "high",
      workflow: "schema-migration",
      piVersion: "0.30.9",
      skills: ["git-archaeologist", "debugging-discipline"],
      extensions: ["sql-explain"],
      publishedAt: ago(2, 8),
      prompt:
        "Inspect every migration for irreversible steps, missing backfills, and lock-heavy statements. Report the rollback path for each change.",
      requirements: ["psql client", "Docker for the explain sandbox"],
      files: [
        ["settings.json", "aa10bb20"],
        ["extensions/sql-explain/index.ts", "de3f4a5b"],
      ],
    },
    {
      owner: "jun",
      name: "docs-sweep",
      revision: "0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d",
      provider: "google",
      model: "gemini-2.5-pro",
      thinking: "unspecified",
      workflow: "docs-audit",
      piVersion: "0.31.0",
      skills: ["natural-writing"],
      extensions: [],
      publishedAt: ago(4, 2),
      prompt: "Audit docs against the code they describe. Flag stale flags, renamed commands, and missing examples.",
      requirements: [],
      files: [["settings.json", "77aa88bb"]],
    },
    {
      owner: "mira",
      name: "review-balanced",
      revision: "b2c3d4e5f6a708192a3b4c5d6e7f809112233445",
      provider: "anthropic",
      model: "claude-sonnet-5",
      thinking: "high",
      workflow: "code-review",
      piVersion: "0.31.2",
      skills: ["security-review", "code-review"],
      extensions: ["lsp-bridge"],
      publishedAt: ago(6, 1),
      prompt: "Balanced review: correctness first, then maintainability. Cite file and line for each finding.",
      requirements: ["Node 22 or newer"],
      files: [
        ["settings.json", "5f6e7d8c"],
        ["extensions/lsp-bridge/index.ts", "5be2a9f0"],
      ],
    },
    {
      owner: "priya",
      name: "incident-triage",
      revision: "e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e",
      provider: "anthropic",
      model: "claude-opus-5",
      thinking: "medium",
      workflow: "incident-triage",
      piVersion: "0.31.1",
      skills: ["debugging-discipline", "solutions"],
      extensions: ["log-tail"],
      publishedAt: ago(9, 6),
      prompt: "Given the frozen log packet, rank hypotheses and state the observation that would falsify each one.",
      requirements: ["Read access to the log bucket"],
      files: [
        ["settings.json", "0f1e2d3c"],
        ["extensions/log-tail/index.ts", "b7a6c5d4"],
      ],
    },
    {
      owner: "sam",
      name: "review-cheap",
      revision: "c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192",
      provider: "openai",
      model: "gpt-5-mini",
      thinking: "low",
      workflow: "code-review",
      piVersion: "0.30.9",
      skills: ["code-review"],
      extensions: [],
      publishedAt: ago(14, 4),
      prompt: "Cheapest useful pass. Only flag crashes, data loss, and security issues.",
      requirements: [],
      files: [["settings.json", "c1d2e3f4"]],
    },
    {
      owner: "jun",
      name: "test-author",
      revision: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d",
      provider: "anthropic",
      model: "claude-sonnet-5",
      thinking: "medium",
      workflow: "test-authoring",
      piVersion: "0.31.0",
      skills: ["test-discipline"],
      extensions: [],
      publishedAt: ago(21, 7),
      prompt: "Write characterisation tests before touching behaviour. Red before green.",
      requirements: ["Project test runner installed"],
      files: [["settings.json", "e9f8a7b6"]],
    },
  ];

  const ASSESS = (v, f, m, by) => ({ validFindings: v, falsePositives: f, missedKnownIssues: m, by });
  const RUNS = [
    { runId: "r9a1f0c3d2e4", setup: "review-strict", actor: "mira", workflow: "code-review", status: "completed", startedAt: ago(0, 4), durationMs: 412000, cost: 1.84, tools: [["read", 42], ["grep", 18], ["bash", 6], ["edit", 0]], skills: 3, model: "anthropic/claude-opus-5 (high)", ctx: "f3a9c2e1b7d04568", rev: "3f9c2a7d", cmp: "cmp-7e21", source: "runner", assess: ASSESS(6, 1, 0, "alex"), turns: 14 },
    { runId: "r8b2e1d4c3f5", setup: "review-fast", actor: "alex", workflow: "code-review", status: "completed", startedAt: ago(0, 4), durationMs: 143000, cost: 0.41, tools: [["read", 23], ["grep", 9], ["bash", 2], ["edit", 0]], skills: 2, model: "anthropic/claude-sonnet-5 (medium)", ctx: "f3a9c2e1b7d04568", rev: "a1b2c3d4", cmp: "cmp-7e21", source: "runner", assess: ASSESS(4, 0, 2, "alex"), turns: 8 },
    { runId: "r7c3d2e5f4a6", setup: "migration-guard", actor: "sam", workflow: "schema-migration", status: "completed", startedAt: ago(1, 2), durationMs: 688000, cost: 2.37, tools: [["read", 31], ["bash", 14], ["sql-explain", 9], ["grep", 7]], skills: 2, model: "openai/gpt-5 (high)", ctx: "0b7d4c11e9a2f335", rev: "77d0e9f1", cmp: null, source: "interactive", assess: null, turns: 22 },
    { runId: "r6d4e3f6a5b7", setup: "review-balanced", actor: "mira", workflow: "code-review", status: "completed", startedAt: ago(2, 9), durationMs: 301000, cost: 0.92, tools: [["read", 37], ["grep", 12], ["bash", 4], ["edit", 0]], skills: 2, model: "anthropic/claude-sonnet-5 (high)", ctx: "6e2b1a90c4d7f812", rev: "b2c3d4e5", cmp: "cmp-5c08", source: "runner", assess: ASSESS(5, 2, 1, "mira"), turns: 11 },
    { runId: "r5e5f4a7b6c8", setup: "review-cheap", actor: "sam", workflow: "code-review", status: "completed", startedAt: ago(2, 9), durationMs: 96000, cost: 0.07, tools: [["read", 15], ["grep", 6], ["bash", 1], ["edit", 0]], skills: 1, model: "openai/gpt-5-mini (low)", ctx: "6e2b1a90c4d7f812", rev: "c9d0e1f2", cmp: "cmp-5c08", source: "runner", assess: ASSESS(2, 1, 4, "mira"), turns: 5 },
    { runId: "r4f6a5b8c7d9", setup: "docs-sweep", actor: "jun", workflow: "docs-audit", status: "aborted", startedAt: ago(3, 1), durationMs: 54000, cost: null, tools: [["read", 9], ["grep", 4]], skills: 1, model: "google/gemini-2.5-pro (unspecified)", ctx: "91c0d3e5b2a7f664", rev: "0c1d2e3f", cmp: null, source: "interactive", assess: null, turns: 3 },
    { runId: "r3a7b6c9d8e0", setup: "incident-triage", actor: "priya", workflow: "incident-triage", status: "completed", startedAt: ago(4, 6), durationMs: 522000, cost: 1.13, tools: [["read", 28], ["log-tail", 16], ["bash", 11], ["grep", 8]], skills: 2, model: "anthropic/claude-opus-5 (medium)", ctx: "2d8f1e0a7b6c5439", rev: "e5f6a7b8", cmp: null, source: "runner", assess: ASSESS(3, 0, 0, "priya"), turns: 17 },
    { runId: "r2b8c7d0e9f1", setup: "review-strict", actor: "alex", workflow: "code-review", status: "completed", startedAt: ago(5, 3), durationMs: 455000, cost: 2.02, tools: [["read", 48], ["grep", 21], ["bash", 7], ["edit", 0]], skills: 3, model: "anthropic/claude-opus-5 (high)", ctx: "aa3b2c1d0e9f8877", rev: "3f9c2a7d", cmp: "cmp-3b44", source: "runner", assess: ASSESS(7, 1, 1, "sam"), turns: 15 },
    { runId: "r1c9d8e1f0a2", setup: "review-balanced", actor: "alex", workflow: "code-review", status: "completed", startedAt: ago(5, 3), durationMs: 287000, cost: 0.88, tools: [["read", 35], ["grep", 14], ["bash", 3], ["edit", 0]], skills: 2, model: "anthropic/claude-sonnet-5 (high)", ctx: "aa3b2c1d0e9f8877", rev: "b2c3d4e5", cmp: "cmp-3b44", source: "runner", assess: ASSESS(6, 3, 2, "sam"), turns: 10 },
    { runId: "r0d0e9f2a1b3", setup: "review-fast", actor: "jun", workflow: "code-review", status: "failed", startedAt: ago(7, 8), durationMs: 21000, cost: null, tools: [["read", 4]], skills: 0, model: "anthropic/claude-sonnet-5 (medium)", ctx: "aa3b2c1d0e9f8877", rev: "a1b2c3d4", cmp: "cmp-3b44", source: "runner", assess: null, turns: 1 },
    { runId: "rze1f0a3b2c4", setup: "test-author", actor: "jun", workflow: "test-authoring", status: "completed", startedAt: ago(9, 5), durationMs: 733000, cost: 1.46, tools: [["read", 26], ["edit", 19], ["bash", 24], ["grep", 5]], skills: 1, model: "anthropic/claude-sonnet-5 (medium)", ctx: "5c4d3e2f1a0b9c87", rev: "d4e5f6a7", cmp: null, source: "interactive", assess: null, turns: 19 },
    { runId: "ryf2a1b4c3d5", setup: "review-strict", actor: "priya", workflow: "code-review", status: "completed", startedAt: ago(12, 2), durationMs: 398000, cost: 1.71, tools: [["read", 40], ["grep", 17], ["bash", 5], ["edit", 0]], skills: 3, model: "anthropic/claude-opus-5 (high)", ctx: "d1e2f3a4b5c6d7e8", rev: "3f9c2a7d", cmp: null, source: "runner", assess: ASSESS(5, 0, 1, "priya"), turns: 13 },
  ];

  const DEVICES = [
    { id: "dev-8f31a2", label: "alex-macbook · pi 0.31.2", state: "connected", lastUsed: ago(0, 1), expires: ago(-58) },
    { id: "dev-2c70e9", label: "ci-runner-03 · pi 0.31.2", state: "connected", lastUsed: ago(0, 6), expires: ago(-41) },
    { id: "dev-b19d44", label: "alex-linux-desk · pi 0.30.9", state: "expired", lastUsed: ago(33), expires: ago(3) },
    { id: "dev-5e0c77", label: "old-laptop · pi 0.29.4", state: "revoked", lastUsed: ago(71), expires: ago(-12) },
  ];

  const MEMBERS = [
    { name: "Alex Lindqvist", email: "alex@acme.example", actorId: "alex", role: "admin", disabled: false, me: true },
    { name: "Mira Okafor", email: "mira@acme.example", actorId: "mira", role: "admin", disabled: false },
    { name: "Sam Reyes", email: "sam@acme.example", actorId: "sam", role: "member", disabled: false },
    { name: "Jun Park", email: "jun@acme.example", actorId: "jun", role: "member", disabled: false },
    { name: "Priya Nair", email: "priya@acme.example", actorId: "priya", role: "member", disabled: false },
    { name: "Theo Baptiste", email: "theo@acme.example", actorId: "theo", role: "member", disabled: true },
  ];

  const INVITES = [
    { id: "inv-1", email: "dana@acme.example", actorId: "dana", role: "member", expires: ago(-5) },
    { id: "inv-2", email: "lee@acme.example", actorId: "lee", role: "admin", expires: ago(-2) },
  ];

  /* Deterministic daily activity for the chart. Seeded so every reload is
     identical. Purely illustrative — labelled "sample data" in the UI. */
  function seeded(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  function makeDaily(seed, base, spread) {
    const rnd = seeded(seed);
    const out = [];
    for (let i = 0; i < 90; i++) {
      const d = new Date(NOW - (89 - i) * DAY);
      const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
      const v = Math.max(0, Math.round((weekend ? base * 0.25 : base) + (rnd() - 0.5) * spread));
      out.push({ date: d.toISOString().slice(0, 10), runs: v });
    }
    return out;
  }
  const DAILY = { live: makeDaily(20260909, 11, 10), demo: makeDaily(4242, 5, 4) };
  const TOOLS = {
    live: [["read", 0.41], ["grep", 0.19], ["bash", 0.17], ["edit", 0.12], ["sql-explain", 0.06]],
    demo: [["read", 0.5], ["bash", 0.25], ["grep", 0.15], ["edit", 0.1]],
  };

  /* ------------------------------------------------------------------
     Helpers
     ------------------------------------------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const num = (n) => new Intl.NumberFormat("en", { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
  const money = (n) => (n === null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 2 : 2 }).format(n));
  const short = (s) => s.slice(0, 8);
  const fmtDate = (iso) => new Date(iso).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  const fmtDay = (iso) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  const duration = (ms) => (ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const icon = (name, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const calls = (r) => r.tools.reduce((n, t) => n + t[1], 0);
  const setupOf = (r) => SETUPS.find((s) => s.name === r.setup);

  let toastTimer;
  function toast(text) {
    const el = $("#toast");
    $("#toast-text").textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
    } catch {
      toast("Select and copy the text manually");
    }
  }
  function statusBadge(status) {
    const cls = status === "completed" ? "green" : status === "aborted" ? "amber" : "red";
    const ic = status === "completed" ? "check" : "x";
    return `<span class="badge ${cls}">${icon(ic, "icon icon-sm")}${status}</span>`;
  }

  /* ------------------------------------------------------------------
     Dialog handling: open, close, focus return, Escape, backdrop
     ------------------------------------------------------------------ */
  let lastTrigger = null;
  function openDialog(dialog, trigger) {
    lastTrigger = trigger || document.activeElement;
    dialog.showModal();
    const first = dialog.querySelector("input, select, textarea, [data-close]");
    if (first) first.focus();
  }
  function closeDialog(dialog) {
    if (!dialog.open) return;
    dialog.close();
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
  }
  $$("dialog").forEach((d) => {
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeDialog(d);
    });
    d.addEventListener("click", (e) => {
      if (e.target === d) closeDialog(d);
    });
    $$("[data-close]", d).forEach((b) => b.addEventListener("click", () => closeDialog(d)));
  });

  /* ------------------------------------------------------------------
     Auth screen
     ------------------------------------------------------------------ */
  const AUTH = {
    login: { eyebrow: "Welcome back", title: "Sign in to Pi Share", lede: "Your shared setups and team activity, in one place.", submit: "Sign in", foot: "New here or locked out? Ask your admin for an invitation or a password reset link. No self-service sign-up.", pw: "Password", pwHint: false },
    setup: { eyebrow: "First-time setup", title: "Create your admin account", lede: "Protected bootstrap: this screen accepts the one-time installation key the server saved at first start. Create the first admin, then invite teammates.", submit: "Create workspace", foot: "Only the holder of the installation key can create the first admin. The key is spent on success.", pw: "Password", pwHint: true },
    join: { eyebrow: "You’re invited", title: "Join acme-eng", lede: "Your invitation is for dana@acme.example and works once. You choose your own password; the admin who invited you never sees it.", submit: "Create my account", foot: "Account access is managed by your team’s admins.", pw: "Choose a password", pwHint: true },
    reset: { eyebrow: "Account recovery", title: "Choose a new password", lede: "Set a new password for alex@acme.example. This also disconnects your devices; each one needs a new device code.", submit: "Reset password", foot: "Reset links are issued by an admin, work once, and expire after 24 hours.", pw: "New password", pwHint: true },
  };
  let variant = "login";
  function setVariant(v) {
    variant = v;
    const t = AUTH[v];
    $("#auth-eyebrow").textContent = t.eyebrow;
    $("#auth-title").textContent = t.title;
    $("#auth-lede").textContent = t.lede;
    $("#auth-submit-label").textContent = t.submit;
    $("#auth-foot").textContent = t.foot;
    $("#f-password-label").textContent = t.pw;
    $("#f-password-hint").hidden = !t.pwHint;
    $("#f-password").autocomplete = v === "login" ? "current-password" : "new-password";
    $$("#auth-form [data-for]").forEach((f) => {
      f.hidden = !f.dataset.for.split(" ").includes(v);
    });
    $$(".auth-variants .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.variant === v)));
    clearErrors($("#auth-form"));
  }
  function clearErrors(form) {
    $$(".field", form).forEach((f) => f.classList.remove("invalid"));
    $$(".field-error", form).forEach((e) => (e.hidden = true));
  }
  function fail(input, errorId) {
    input.closest(".field").classList.add("invalid");
    $(errorId).hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", errorId.slice(1));
    return false;
  }
  $$(".auth-variants .chip").forEach((c) => c.addEventListener("click", () => setVariant(c.dataset.variant)));
  // Explicit sample entry also works in embedded previews that intercept forms.
  $("#explore-prototype").addEventListener("click", () => {
    sessionStorage.setItem("pishare-proto-signed-in", "1");
    showApp(true);
    navigate("overview");
  });
  $("#auth-form").addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrors(e.currentTarget);
    let ok = true;
    const email = $("#f-email");
    const pw = $("#f-password");
    if (!email.closest(".field").hidden && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) ok = fail(email, "#f-email-error");
    if (!pw.value || (variant !== "login" && pw.value.length < 12)) ok = fail(pw, "#f-password-error");
    if (!ok) return;
    const btn = $("#auth-submit");
    btn.disabled = true;
    $("#auth-submit-label").textContent = "Please wait…";
    setTimeout(() => {
      btn.disabled = false;
      $("#auth-submit-label").textContent = AUTH[variant].submit;
      sessionStorage.setItem("pishare-proto-signed-in", "1");
      showApp(true);
      navigate("overview");
    }, 500);
  });
  $$("#auth-form input").forEach((i) => i.addEventListener("blur", () => {
    if (i.value) i.closest(".field").classList.remove("invalid");
  }));

  /* ------------------------------------------------------------------
     Shell: screens, navigation, menu
     ------------------------------------------------------------------ */
  const PAGES = ["overview", "setups", "activity", "comparisons", "devices", "team"];
  const scrollMemory = {};
  let currentPage = null;

  function showApp(on) {
    $("#screen-auth").classList.toggle("active", !on);
    $("#screen-app").classList.toggle("active", on);
  }
  function navigate(page) {
    if (location.hash !== `#/${page}`) location.hash = `#/${page}`;
    else route();
  }
  function route() {
    const hash = location.hash.replace(/^#\/?/, "");
    if (hash === "signin" || !sessionStorage.getItem("pishare-proto-signed-in")) {
      showApp(false);
      setVariant("login");
      return;
    }
    const page = PAGES.includes(hash) ? hash : "overview";
    showApp(true);
    if (currentPage) scrollMemory[currentPage] = window.scrollY;
    $$(".page").forEach((p) => (p.hidden = p.id !== `page-${page}`));
    $$(".nav-item").forEach((a) => {
      if (a.dataset.page === page) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    const title = $(`#page-${page}`).dataset.title;
    $("#crumb-page").textContent = title;
    document.title = `${title} · Pi Share — Dark Console`;
    closeMenu();
    const changed = currentPage !== page;
    currentPage = page;
    if (changed) {
      window.scrollTo({ top: scrollMemory[page] || 0 });
      const h1 = $(`#page-${page} h1`);
      if (h1) {
        h1.setAttribute("tabindex", "-1");
        h1.focus({ preventScroll: true });
      }
    }
  }
  window.addEventListener("hashchange", route);

  function closeMenu() {
    $("#workspace").classList.remove("nav-open");
    $("#menu-toggle").setAttribute("aria-expanded", "false");
  }
  $("#menu-toggle").addEventListener("click", () => {
    const open = !$("#workspace").classList.contains("nav-open");
    $("#workspace").classList.toggle("nav-open", open);
    $("#menu-toggle").setAttribute("aria-expanded", String(open));
    if (open) $(".nav-item[aria-current='page']")?.focus();
  });
  $("#nav-backdrop").addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#workspace").classList.contains("nav-open")) {
      closeMenu();
      $("#menu-toggle").focus();
    }
  });
  $("#sign-out").addEventListener("click", () => {
    sessionStorage.removeItem("pishare-proto-signed-in");
    currentPage = null;
    location.hash = "#/signin";
    route();
  });

  /* Copy buttons anywhere (static or rendered) */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    const src = $(btn.dataset.copy);
    if (src) copyText(src.textContent.trim());
  });

  /* ------------------------------------------------------------------
     Overview: filters, metrics, chart, tools, recent
     ------------------------------------------------------------------ */
  const state = { mode: "live", days: 30 };

  function slice() {
    return DAILY[state.mode].slice(90 - state.days);
  }
  function renderOverview() {
    const days = slice();
    const runs = days.reduce((n, d) => n + d.runs, 0);
    const members = state.mode === "live" ? 5 : 2;
    const toolCalls = Math.round(runs * (state.mode === "live" ? 31.4 : 12.2));
    const skillLoads = Math.round(runs * 1.7);
    const missing = Math.round(runs * 0.08);
    const spend = runs * (state.mode === "live" ? 1.12 : 0.21);
    const setups = state.mode === "live" ? SETUPS.length : 2;

    const set = (k, v, note) => {
      $(`[data-metric="${k}"]`).textContent = v;
      $(`[data-note="${k}"]`).textContent = note;
    };
    set("runs", num(runs), `Across ${members} active members · sample`);
    set("spend", money(spend), missing ? `${missing} runs excluded: incomplete pricing · sample` : "USD · provider usage estimates · sample");
    set("tools", num(toolCalls), `${num(skillLoads)} observed skill loads · sample`);
    set("setups", num(setups), "Latest published revisions · sample");

    $("#demo-notice").hidden = state.mode !== "demo";
    $$(".segmented [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    $("#chart-legend").innerHTML = `<i class="${state.mode === "demo" ? "demo" : ""}"></i>${state.mode} runs`;

    renderChart(days);
    renderTools(toolCalls);
    renderRecent();
  }

  function renderChart(days) {
    const svg = $("#chart");
    const W = 640, H = 200, padL = 34, padR = 8, padT = 12, padB = 24;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const max = Math.max(1, ...days.map((d) => d.runs));
    const niceMax = Math.ceil(max / 5) * 5 || 5;
    const gap = days.length > 31 ? 1 : days.length > 7 ? 3 : 10;
    const bw = (innerW - gap * (days.length - 1)) / days.length;
    let out = "";
    [0, 0.5, 1].forEach((f) => {
      const y = padT + innerH - innerH * f;
      out += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
      out += `<text class="axis-text" x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end">${Math.round(niceMax * f)}</text>`;
    });
    days.forEach((d, i) => {
      const h = (d.runs / niceMax) * innerH;
      const x = padL + i * (bw + gap);
      const y = padT + innerH - h;
      out += `<rect class="bar ${state.mode === "demo" ? "demo" : ""}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${bw.toFixed(2)}" height="${Math.max(h, d.runs ? 2 : 0).toFixed(2)}" rx="1" data-i="${i}"><title>${d.date}: ${d.runs} runs</title></rect>`;
    });
    const labelAt = (i, anchor) => `<text class="axis-text" x="${(padL + i * (bw + gap) + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${fmtDay(days[i].date)}</text>`;
    out += labelAt(0, "start") + labelAt(Math.floor(days.length / 2), "middle") + labelAt(days.length - 1, "end");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.aspectRatio = `${W} / ${H}`;
    svg.innerHTML = out;
    const total = days.reduce((n, d) => n + d.runs, 0);
    const peak = days.reduce((a, b) => (b.runs > a.runs ? b : a));
    $("#chart-desc").textContent = `Sample bar chart of ${state.mode} runs per day over the last ${days.length} days: ${total} runs in total, peak of ${peak.runs} on ${peak.date}. Values are illustrative sample data.`;

    const tip = $("#chart-tip");
    svg.onmousemove = (e) => {
      const bar = e.target.closest(".bar");
      if (!bar) return tip.classList.remove("show");
      const d = days[Number(bar.dataset.i)];
      const wrap = $("#chart-wrap").getBoundingClientRect();
      const r = bar.getBoundingClientRect();
      tip.textContent = `${d.date} · ${d.runs} runs`;
      tip.style.left = `${r.left - wrap.left + r.width / 2}px`;
      tip.style.top = `${r.top - wrap.top - 6}px`;
      tip.classList.add("show");
    };
    svg.onmouseleave = () => tip.classList.remove("show");
  }

  function renderTools(totalCalls) {
    const list = TOOLS[state.mode];
    const maxShare = list[0][1];
    $("#tool-list").innerHTML = list
      .map(([name, share]) => `
        <div class="tool-row">
          <div class="od-row"><code>${esc(name)}</code><strong>${num(Math.round(totalCalls * share))}</strong></div>
          <div class="meter" role="img" aria-label="${esc(name)}: ${Math.round(share * 100)} percent of tool calls"><i style="width:${(share / maxShare) * 100}%"></i></div>
        </div>`)
      .join("");
  }

  function renderRecent() {
    const rows = [...SETUPS].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 5);
    $("#recent-body").innerHTML = rows
      .map((p) => `
        <tr>
          <td><button class="text-button" type="button" data-inspect="${esc(p.owner)}/${esc(p.name)}">${icon("box", "icon icon-sm")}${esc(p.name)}</button></td>
          <td>${esc(p.owner)}</td>
          <td>${esc(p.model)}</td>
          <td><span class="badge">${esc(p.workflow)}</span></td>
          <td><code>${short(p.revision)}</code></td>
          <td class="od-nowrap">${fmtDate(p.publishedAt)}</td>
        </tr>`)
      .join("");
  }

  $$(".segmented [data-mode]").forEach((b) => b.addEventListener("click", () => {
    state.mode = b.dataset.mode;
    renderOverview();
  }));
  $("#range").addEventListener("change", (e) => {
    state.days = Number(e.target.value);
    renderOverview();
  });
  $("#refresh").addEventListener("click", () => {
    const btn = $("#refresh");
    btn.disabled = true;
    setTimeout(() => {
      renderOverview();
      btn.disabled = false;
      toast("Refreshed sample data");
    }, 400);
  });

  /* ------------------------------------------------------------------
     Shared setups: search, filters, inspect drawer
     ------------------------------------------------------------------ */
  const filters = { q: "", workflow: "", model: "" };
  function initSetupFilters() {
    const wf = [...new Set(SETUPS.map((s) => s.workflow))].sort();
    const md = [...new Set(SETUPS.map((s) => s.model))].sort();
    $("#setup-workflow").innerHTML += wf.map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join("");
    $("#setup-model").innerHTML += md.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
    $("#nav-setups-count").textContent = SETUPS.length;
  }
  function renderSetups() {
    const q = filters.q.trim().toLowerCase();
    const list = SETUPS.filter((p) =>
      (!q || `${p.owner} ${p.name} ${p.workflow} ${p.model} ${p.provider}`.toLowerCase().includes(q)) &&
      (!filters.workflow || p.workflow === filters.workflow) &&
      (!filters.model || p.model === filters.model)
    ).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    $("#library-count").textContent = q || filters.workflow || filters.model ? `${list.length} of ${SETUPS.length}` : SETUPS.length;
    $("#setups-empty").hidden = list.length > 0;
    $("#setups-body").innerHTML = list
      .map((p) => `
        <tr>
          <td>
            <span class="od-stat">
              <strong>${esc(p.name)}</strong>
              <span class="sub">${p.skills.length} skills · ${p.extensions.length} extensions · pi ${esc(p.piVersion)}</span>
            </span>
          </td>
          <td>${esc(p.owner)}</td>
          <td><code title="${esc(p.revision)}">${short(p.revision)}</code></td>
          <td>
            <span class="od-stat">
              <strong style="font-weight:400">${esc(p.model)}</strong>
              <span class="sub">${esc(p.provider)} · thinking ${esc(p.thinking)}</span>
            </span>
          </td>
          <td><span class="badge">${esc(p.workflow)}</span></td>
          <td class="od-nowrap">${fmtDate(p.publishedAt)}</td>
          <td class="actions"><button class="text-button" type="button" data-inspect="${esc(p.owner)}/${esc(p.name)}">Inspect ${icon("arrow-right", "icon icon-sm")}</button></td>
        </tr>`)
      .join("");
  }
  $("#setup-search").addEventListener("input", (e) => {
    filters.q = e.target.value;
    renderSetups();
  });
  $("#setup-workflow").addEventListener("change", (e) => {
    filters.workflow = e.target.value;
    renderSetups();
  });
  $("#setup-model").addEventListener("change", (e) => {
    filters.model = e.target.value;
    renderSetups();
  });
  $("#setups-clear").addEventListener("click", () => {
    filters.q = filters.workflow = filters.model = "";
    $("#setup-search").value = "";
    $("#setup-workflow").value = "";
    $("#setup-model").value = "";
    renderSetups();
    $("#setup-search").focus();
  });

  function openSetup(key, trigger) {
    const [owner, name] = key.split("/");
    const p = SETUPS.find((s) => s.owner === owner && s.name === name);
    if (!p) return;
    const command = `pi-share team pull ${TEAM.name} ${p.owner}/${p.name} --scope ${TEAM.scope} --revision ${p.revision}`;
    $("#drawer-eyebrow").textContent = `Shared setup · revision ${short(p.revision)}`;
    $("#drawer-title").textContent = `${p.owner} / ${p.name}`;
    $("#drawer-body").innerHTML = `
      <dl class="detail-grid">
        <div><dt>Model</dt><dd>${esc(p.provider)}/${esc(p.model)}</dd></div>
        <div><dt>Thinking</dt><dd>${esc(p.thinking)}</dd></div>
        <div><dt>Workflow</dt><dd><span class="badge">${esc(p.workflow)}</span></dd></div>
        <div><dt>Runtime</dt><dd>Pi ${esc(p.piVersion)} · ${esc(TEAM.scope)}</dd></div>
        <div><dt>Immutable revision</dt><dd><code class="break">${esc(p.revision)}</code></dd></div>
        <div><dt>Last shared</dt><dd>${fmtDate(p.publishedAt)} UTC</dd></div>
      </dl>

      <h3 class="section-title">Try this setup locally</h3>
      <p class="text-small muted">Pulls a pinned copy to your device. Your credentials and local context stay on your machine.</p>
      <div class="cmd spaced"><pre id="pull-cmd">${esc(command)}</pre></div>
      <div class="cmd-actions">
        <button class="button primary small" type="button" data-copy="#pull-cmd">${icon("copy", "icon icon-sm")}Copy pull command</button>
        <span class="sample-tag">sample</span>
      </div>

      <h3 class="section-title">Workflow instructions</h3>
      <pre>${esc(p.prompt)}</pre>

      <h3 class="section-title">Skills and extensions</h3>
      <div class="tag-list">
        ${p.skills.map((s) => `<span class="badge">${esc(s)}</span>`).join("")}
        ${p.extensions.map((s) => `<span class="badge mono">ext · ${esc(s)}</span>`).join("")}
        ${!p.skills.length && !p.extensions.length ? '<p class="muted text-small">No bundled skills or extensions.</p>' : ""}
      </div>

      <h3 class="section-title">Local requirements</h3>
      ${p.requirements.length ? `<ul class="text-small muted" style="margin:0;padding-left:18px">${p.requirements.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : '<p class="muted text-small">No additional requirements declared.</p>'}

      <details class="spaced">
        <summary>Bundled files (${p.files.length})</summary>
        <div class="details-body">
          ${p.files.map(([f, h]) => `<p><code>${esc(f)}</code> <span class="faint mono">${esc(h)}</span></p>`).join("")}
        </div>
      </details>
      <details class="spaced">
        <summary>Configuration and package details</summary>
        <div class="details-body"><pre style="margin-top:8px">${esc(JSON.stringify({ settings: { defaultProvider: p.provider, defaultModel: p.model, defaultThinkingLevel: p.thinking }, packages: p.extensions, omittedSettings: ["apiKeys", "localPaths"] }, null, 2))}</pre></div>
      </details>

      <div class="notice spaced warn">
        ${icon("alert")}
        <span>Extensions are executable code. Review a pulled setup before running it. Compare using the same frozen review packet to control code and context.</span>
      </div>`;
    openDialog($("#drawer-setup"), trigger);
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-inspect]");
    if (b) openSetup(b.dataset.inspect, b);
  });

  /* ------------------------------------------------------------------
     Activity: run list with selection → compare
     ------------------------------------------------------------------ */
  const selected = new Set();
  function renderRuns() {
    const rows = [...RUNS].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    $("#runs-count").textContent = rows.length;
    $("#runs-body").innerHTML = rows
      .map((r) => `
        <tr class="${selected.has(r.runId) ? "selected" : ""}">
          <td><input type="checkbox" data-select="${r.runId}" aria-label="Select ${esc(r.setup)} run ${short(r.runId)} for comparison" ${selected.has(r.runId) ? "checked" : ""} ${!selected.has(r.runId) && selected.size >= 4 ? "disabled" : ""}></td>
          <td>
            <span class="od-stat">
              <strong>${esc(r.setup)}</strong>
              <span class="sub">${esc(r.workflow)} · ${short(r.runId)} · ${fmtDate(r.startedAt)}</span>
            </span>
          </td>
          <td>${esc(r.actor)}</td>
          <td>${statusBadge(r.status)}</td>
          <td class="num od-nowrap">${duration(r.durationMs)}</td>
          <td>${calls(r)} calls · ${r.skills} skills</td>
          <td class="num od-nowrap">${money(r.cost)}</td>
        </tr>`)
      .join("");
    const btn = $("#compare-selected");
    btn.disabled = selected.size < 2;
    $("#compare-n").textContent = selected.size ? `(${selected.size})` : "";
  }
  $("#runs-body").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-select]");
    if (!cb) return;
    if (cb.checked) selected.add(cb.dataset.select);
    else selected.delete(cb.dataset.select);
    renderRuns();
    $(`[data-select="${cb.dataset.select}"]`)?.focus();
  });
  $("#compare-selected").addEventListener("click", (e) => {
    openCompare(RUNS.filter((r) => selected.has(r.runId)), "Selected runs", e.currentTarget);
  });

  /* ------------------------------------------------------------------
     Comparisons: experiments list + compare modal
     ------------------------------------------------------------------ */
  function experiments() {
    const map = new Map();
    RUNS.filter((r) => r.cmp).forEach((r) => map.set(r.cmp, [...(map.get(r.cmp) || []), r]));
    return [...map.entries()].sort((a, b) => b[1][0].startedAt.localeCompare(a[1][0].startedAt));
  }
  function renderExperiments() {
    const list = experiments();
    $("#exp-count").textContent = list.length;
    $("#exp-body").innerHTML = list
      .map(([id, runs]) => {
        const same = new Set(runs.map((r) => r.ctx)).size === 1;
        const assessed = runs.filter((r) => r.assess).length;
        return `
        <tr>
          <td><span class="od-stat"><code>${esc(id)}</code><span class="sub">${fmtDate(runs[0].startedAt)}</span></span></td>
          <td>${[...new Set(runs.map((r) => r.setup))].map((s) => `<span class="badge">${esc(s)}</span>`).join(" ")}</td>
          <td class="num">${runs.length}</td>
          <td><span class="badge ${same ? "green" : "amber"}">${icon(same ? "check" : "alert", "icon icon-sm")}${same ? "Frozen context matches" : "Context differs"}</span></td>
          <td>${assessed}/${runs.length} scored</td>
          <td class="actions"><button class="text-button" type="button" data-compare="${esc(id)}">Compare ${icon("arrow-right", "icon icon-sm")}</button></td>
        </tr>`;
      })
      .join("");
  }
  $("#exp-body").addEventListener("click", (e) => {
    const b = e.target.closest("[data-compare]");
    if (!b) return;
    openCompare(RUNS.filter((r) => r.cmp === b.dataset.compare), `Experiment ${b.dataset.compare}`, b);
  });

  function openCompare(runs, label, trigger) {
    const contexts = new Set(runs.map((r) => `${r.source}:${r.ctx}`));
    const frozen = runs.every((r) => r.source === "runner");
    const models = new Set(runs.map((r) => r.model));
    const maxCalls = Math.max(...runs.flatMap((r) => r.tools.map((t) => t[1])), 1);

    let banner;
    if (!frozen) banner = `<div class="notice warn">${icon("alert")}<span><strong>Includes interactive sessions.</strong> Their hashes describe starting session branches, not frozen code packets; matching hashes do not establish equal code or context.</span></div>`;
    else if (contexts.size === 1) banner = `<div class="success">${icon("check")}<span><strong>Frozen context matches.</strong> All ${runs.length} runs used packet <code>${short(runs[0].ctx)}</code>, so differences come from the setup, not the code.</span></div>`;
    else banner = `<div class="notice warn">${icon("alert")}<span><strong>${contexts.size} different context fingerprints.</strong> Differences may come from code or context as well as the setup.</span></div>`;

    $("#compare-eyebrow").textContent = `${label} · ${runs.length} runs`;
    $("#compare-title").textContent = "Compare setups";
    $("#compare-body").innerHTML = `
      <div class="compare-head">
        ${banner}
        ${models.size > 1 ? `<div class="notice">${icon("info")}<span>Models or thinking settings differ. Treat these as separate experimental variables.</span></div>` : ""}
        <div class="local-note">${icon("shield")}<span><strong>Model output and code stay local.</strong> This view shows metadata only: timing, token-derived cost estimates, tool counts, fingerprints, and human scores. Read the actual findings on the device that ran the packet.</span></div>
        <p class="text-small muted">Cost and speed describe usage. Human assessment describes review quality. No automatic winner is inferred. <span class="sample-tag">sample data</span></p>
      </div>
      <div class="comparison-grid">
        ${runs.map((r) => compareCard(r, maxCalls)).join("")}
      </div>`;
    openDialog($("#modal-compare"), trigger);
  }
  function compareCard(r, maxCalls) {
    const s = setupOf(r);
    return `
      <article class="comparison-card" aria-label="${esc(r.setup)} run ${short(r.runId)}">
        <div class="od-row-top">
          <div class="od-stat">
            <h3>${esc(r.setup)}</h3>
            <span class="sub">${esc(r.actor)} · ${short(r.runId)} · ${esc(r.workflow)}</span>
          </div>
          ${statusBadge(r.status)}
        </div>
        <dl>
          <div><dt>Duration</dt><dd>${duration(r.durationMs)}<small>${r.turns} turns</small></dd></div>
          <div><dt>Estimated cost</dt><dd>${money(r.cost)}<small>${r.cost === null ? "incomplete pricing" : "USD · provider usage"}</small></dd></div>
          <div><dt>Tool calls</dt><dd>${calls(r)}<small>${r.tools.length} distinct tools</small></dd></div>
          <div><dt>Observed skills</dt><dd>${r.skills}<small>${s ? `of ${s.skills.length} bundled` : ""}</small></dd></div>
        </dl>
        <h3 class="section-title">Model</h3>
        <p class="text-small break">${esc(r.model)}</p>
        <h3 class="section-title">Tool usage</h3>
        <div class="tool-mini">
          ${r.tools.map(([n, c]) => `<div class="od-row"><code>${esc(n)}</code><span class="mono text-small">${c}</span></div><div class="meter" aria-hidden="true"><i style="width:${(c / maxCalls) * 100}%"></i></div>`).join("")}
        </div>
        <h3 class="section-title">Context / setup revision</h3>
        <p class="text-small"><code title="${esc(r.ctx)}">${short(r.ctx)}</code> / <code>${esc(r.rev)}</code></p>
        <h3 class="section-title">Human assessment</h3>
        ${r.assess ? `
          <div class="assess">
            <div class="od-row"><span class="badge">${esc(r.assess.by)}</span><span class="text-xs faint">latest score</span></div>
            <div class="scores">
              <span><b>${r.assess.validFindings}</b> valid</span>
              <span><b>${r.assess.falsePositives}</b> false positives</span>
              <span><b>${r.assess.missedKnownIssues}</b> missed</span>
            </div>
          </div>` : `<p class="text-small muted">Not scored. ${r.status === "completed" ? "Review the output locally, then add an assessment." : "Only completed runs can be scored."}</p>`}
      </article>`;
  }

  /* ------------------------------------------------------------------
     My devices: pairing flow
     ------------------------------------------------------------------ */
  function renderDevices() {
    $("#device-list").innerHTML = DEVICES.map((d) => {
      const badge = d.state === "connected" ? `<span class="badge green">${icon("check", "icon icon-sm")}Connected</span>` : d.state === "expired" ? `<span class="badge amber">${icon("clock", "icon icon-sm")}Expired</span>` : `<span class="badge red">${icon("x", "icon icon-sm")}Revoked</span>`;
      return `
        <div class="device-card">
          ${icon("monitor")}
          <span class="od-stat">
            <strong>${esc(d.label)} ${badge}</strong>
            <small>${d.lastUsed ? `last active ${fmtDate(d.lastUsed)}` : "not used yet"} · expires ${fmtDay(d.expires)} · ${esc(d.id)}</small>
          </span>
          ${d.state !== "revoked" ? `<button class="text-button" type="button" data-revoke="${esc(d.id)}">Revoke</button>` : ""}
        </div>`;
    }).join("");
  }
  $("#device-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#device-code");
    clearErrors(e.currentTarget);
    $("#approval").hidden = true;
    $("#approval-done").hidden = true;
    const code = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code)) return fail(input, "#device-code-error");
    input.value = code;
    $("#approval-code").textContent = code;
    $("#approval").hidden = false;
    $("#approve-yes").focus();
  });
  $("#device-code").addEventListener("input", (e) => {
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
    e.target.value = v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v;
  });
  $("#approve-yes").addEventListener("click", () => {
    $("#approval").hidden = true;
    $("#approval-done").hidden = false;
    DEVICES.unshift({ id: `dev-${$("#approval-code").textContent.slice(0, 5).toLowerCase()}0`, label: "alex-macbook · pi 0.31.2", state: "connected", lastUsed: null, expires: ago(-60) });
    $("#device-code").value = "";
    renderDevices();
    toast("Device approved");
  });
  $("#approve-no").addEventListener("click", () => {
    $("#approval").hidden = true;
    $("#device-code").value = "";
    toast("Device request denied");
    $("#device-code").focus();
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-revoke]");
    if (!b) return;
    const d = DEVICES.find((x) => x.id === b.dataset.revoke);
    $("#confirm-eyebrow").textContent = "My devices";
    $("#confirm-title").textContent = "Disconnect this device?";
    $("#confirm-copy").innerHTML = `Revoke access for <strong>${esc(d.label)}</strong>. Its local files stay on that device. It will need a new device code to reconnect.`;
    $("#confirm-yes").textContent = "Revoke device";
    $("#confirm-yes").onclick = () => {
      d.state = "revoked";
      renderDevices();
      closeDialog($("#modal-confirm"));
      toast("Device revoked");
    };
    openDialog($("#modal-confirm"), b);
  });

  /* ------------------------------------------------------------------
     Team & access: members, invitations
     ------------------------------------------------------------------ */
  function renderTeam() {
    $("#members-count").textContent = MEMBERS.length;
    $("#members-body").innerHTML = MEMBERS.map((u) => `
      <tr>
        <td><span class="od-stat"><strong>${esc(u.name)}${u.me ? " (you)" : ""}</strong><span class="sub">${esc(u.email)}</span></span></td>
        <td><code>${esc(u.actorId)}</code></td>
        <td><span class="badge">${esc(u.role)}</span></td>
        <td><span class="badge ${u.disabled ? "red" : "green"}">${icon(u.disabled ? "x" : "check", "icon icon-sm")}${u.disabled ? "Disabled" : "Active"}</span></td>
        <td>
          <div class="row-actions">
            <button class="text-button quiet" type="button" data-role="${esc(u.actorId)}" ${u.me ? "disabled" : ""}>${u.role === "admin" ? "Make member" : "Make admin"}</button>
            <button class="text-button quiet" type="button" data-toggle="${esc(u.actorId)}" ${u.me ? "disabled" : ""}>${u.disabled ? "Enable" : "Disable"}</button>
            ${u.disabled ? "" : `<button class="text-button quiet" type="button" data-reset="${esc(u.actorId)}">Reset link</button>`}
          </div>
        </td>
      </tr>`).join("");
    $("#invites-count").textContent = INVITES.length;
    $("#invites-empty").hidden = INVITES.length > 0;
    $("#invites-body").innerHTML = INVITES.map((i) => `
      <tr>
        <td>${esc(i.email)}</td>
        <td><code>${esc(i.actorId)}</code></td>
        <td><span class="badge">${esc(i.role)}</span></td>
        <td class="od-nowrap">${fmtDate(i.expires)}</td>
        <td class="actions"><button class="text-button quiet" type="button" data-revoke-invite="${esc(i.id)}">Revoke</button></td>
      </tr>`).join("");
  }
  function showLink(kind, url, copy) {
    $("#link-kind").textContent = kind;
    $("#link-title").textContent = `${kind} link ready`;
    $("#link-url").textContent = url;
    $("#link-copy").textContent = copy;
  }
  document.addEventListener("click", (e) => {
    const roleBtn = e.target.closest("[data-role]");
    const toggleBtn = e.target.closest("[data-toggle]");
    const resetBtn = e.target.closest("[data-reset]");
    const revokeInv = e.target.closest("[data-revoke-invite]");
    if (roleBtn) {
      const u = MEMBERS.find((m) => m.actorId === roleBtn.dataset.role);
      const next = u.role === "admin" ? "member" : "admin";
      $("#confirm-eyebrow").textContent = "Team & access";
      $("#confirm-title").textContent = `Change role to ${next}?`;
      $("#confirm-copy").innerHTML = `<strong>${esc(u.name)}</strong> (${esc(u.email)}) will become ${next === "admin" ? "an admin. Admins can invite or disable members and issue password reset links." : "a member."}`;
      $("#confirm-yes").textContent = "Confirm change";
      $("#confirm-yes").onclick = () => {
        u.role = next;
        renderTeam();
        closeDialog($("#modal-confirm"));
        toast(`${u.name} is now ${next}`);
      };
      openDialog($("#modal-confirm"), roleBtn);
    } else if (toggleBtn) {
      const u = MEMBERS.find((m) => m.actorId === toggleBtn.dataset.toggle);
      $("#confirm-eyebrow").textContent = "Team & access";
      $("#confirm-title").textContent = u.disabled ? "Enable this account?" : "Disable this account?";
      $("#confirm-copy").innerHTML = `<strong>${esc(u.name)}</strong> (${esc(u.email)}) ${u.disabled ? "will be able to sign in again. Revoked device credentials remain revoked." : "will lose account access and all connected device credentials will be revoked."}`;
      $("#confirm-yes").textContent = u.disabled ? "Enable account" : "Disable account";
      $("#confirm-yes").onclick = () => {
        u.disabled = !u.disabled;
        renderTeam();
        closeDialog($("#modal-confirm"));
        toast(u.disabled ? "Account disabled" : "Account enabled");
      };
      openDialog($("#modal-confirm"), toggleBtn);
    } else if (resetBtn) {
      const u = MEMBERS.find((m) => m.actorId === resetBtn.dataset.reset);
      showLink("Password reset", `https://pi.acme.internal/reset#token=prs_${u.actorId}9Xq…redacted`, `Share this link privately with ${u.name}. It works once and expires in 24 hours. Copy it now; the server keeps only its hash.`);
      openDialog($("#modal-link"), resetBtn);
    } else if (revokeInv) {
      const i = INVITES.findIndex((x) => x.id === revokeInv.dataset.revokeInvite);
      if (i > -1) INVITES.splice(i, 1);
      renderTeam();
      toast("Invitation revoked");
    }
  });
  $("#open-invite").addEventListener("click", (e) => {
    $("#invite-form").reset();
    clearErrors($("#invite-form"));
    openDialog($("#modal-invite"), e.currentTarget);
  });
  $("#invite-form").addEventListener("submit", (e) => {
    e.preventDefault();
    clearErrors(e.currentTarget);
    const email = $("#inv-email");
    const handle = $("#inv-handle");
    let ok = true;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) ok = fail(email, "#inv-email-error");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(handle.value)) ok = fail(handle, "#inv-handle-error");
    if (!ok) return;
    INVITES.unshift({ id: `inv-${Date.now()}`, email: email.value, actorId: handle.value, role: $("#inv-role").value, expires: ago(-7) });
    renderTeam();
    closeDialog($("#modal-invite"));
    showLink("Invitation", `https://pi.acme.internal/join#token=pin_${handle.value}7Kq2…redacted`, `Share this link privately with ${email.value}. It can be used once and expires in 7 days. Copy it now; the server keeps only its hash.`);
    openDialog($("#modal-link"), $("#open-invite"));
  });

  /* ------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------ */
  initSetupFilters();
  renderOverview();
  renderSetups();
  renderRuns();
  renderExperiments();
  renderDevices();
  renderTeam();
  if (location.hash && location.hash !== "#/signin" && PAGES.includes(location.hash.replace(/^#\/?/, ""))) {
    sessionStorage.setItem("pishare-proto-signed-in", "1");
  }
  route();
})();
