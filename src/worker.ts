import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { canonical, digest, inside, jsonRead, jsonWrite, walk } from "./files.js";
import { restoreReviewGit, validatePacket } from "./context.js";
import { Collector, type MetricIdentity } from "./metrics.js";
import { materializeProfile, validateProfile } from "./profiles.js";
import type { Metrics } from "./schema.js";

export interface WorkerRequest {
  profilePath: string; packetPath: string; runDir: string; authDir: string;
  identity: MetricIdentity; modelOverride?: string; thinkingOverride?: Metrics["models"][number]["thinking"];
  timeoutSeconds: number; demoUrl?: string;
  toolPolicy: "profile" | "read-only";
}

export async function executeReview(request: WorkerRequest): Promise<Metrics> {
  const profile = validateProfile(jsonRead(request.profilePath));
  const workspace = join(request.runDir, "workspace"); const packet = validatePacket(workspace);
  restoreReviewGit(workspace, packet);
  const agentDir = join(request.runDir, "config"); materializeProfile(profile, agentDir);
  const text = (p: string) => readFileSync(join(agentDir, p), "utf8");
  const packetInstructions = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"].map(n => join(workspace, "repo", n)).find(existsSync);
  const settingsManager = SettingsManager.inMemory({ ...profile.settings, packages: [], enableAnalytics: false, enableInstallTelemetry: false }, { projectTrusted: false });
  const scopeGuard = (pi: ExtensionAPI) => {
    pi.on("tool_call", event => {
      if (!["read", "grep", "find", "ls"].includes(event.toolName)) return;
      const input = event.input as { path?: string };
      try {
        const target = realpathSync(resolve(workspace, input.path ?? "."));
        if (![workspace, agentDir].some(root => inside(realpathSync(root), target))) return { block: true, reason: "Review tools can read only this run's frozen context and profile." };
      } catch { return { block: true, reason: "Review path does not exist in the frozen context." }; }
      return;
    });
  };
  const loader = new DefaultResourceLoader({
    cwd: workspace, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true, noThemes: true,
    additionalExtensionPaths: [...profile.packages, ...profile.resources.extensions.map(p => join(agentDir, p))],
    additionalSkillPaths: profile.resources.skills.map(p => join(agentDir, p)),
    additionalPromptTemplatePaths: profile.resources.prompts.map(p => join(agentDir, p)),
    extensionFactories: [{ name: "pi-share-context", factory: scopeGuard }],
    agentsFilesOverride: () => ({ agentsFiles: [
      ...profile.instructions.map(p => ({ path: join(agentDir, p), content: text(p) })),
      ...(packetInstructions ? [{ path: packetInstructions, content: readFileSync(packetInstructions, "utf8") }] : []),
    ] }),
    systemPromptOverride: () => profile.systemPrompt ? text(profile.systemPrompt) : undefined,
    appendSystemPromptOverride: () => [
      ...profile.appendSystemPrompt.map(text),
      "This is a local review comparison. PR.diff contains the frozen diff. repo/ contains the head revision with Git branches base and review (HEAD). context/ contains any explicitly provided extra context. Your session is fresh. Do not modify any files. Use this run's frozen inputs rather than external copies of the repository.",
    ],
  });
  await loader.reload();
  if (loader.getExtensions().errors.length || loader.getSkills().diagnostics.some(d => d.type === "error") || loader.getPrompts().diagnostics.some(d => d.type === "error")) throw new Error("Profile resources did not load successfully");
  const modelRuntime = await ModelRuntime.create({
    authPath: join(request.authDir, "auth.json"), modelsPath: join(request.authDir, "models.json"),
    modelsStorePath: join(agentDir, "models-cache.json"), refreshOnCreate: false,
  });
  // Extensions can define the selected provider. Apply their declarations before model lookup,
  // matching Pi's createAgentSessionServices initialization order.
  const runtime = loader.getExtensions().runtime;
  for (const { name, config } of runtime.pendingProviderRegistrations) modelRuntime.registerProvider(name, config);
  runtime.pendingProviderRegistrations = [];
  for (const { provider } of runtime.pendingNativeProviderRegistrations) modelRuntime.registerNativeProvider(provider);
  runtime.pendingNativeProviderRegistrations = [];
  await modelRuntime.refresh({ allowNetwork: false });
  if (request.demoUrl) {
    modelRuntime.registerProvider("pi-share-demo", { baseUrl: request.demoUrl, api: "openai-completions", apiKey: "demo-local-only",
      models: [{ id: "fixture", name: "Scripted demo (not a model evaluation)", reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 2048,
      }],
    });
  }
  const modelRef = request.modelOverride ?? `${profile.settings.defaultProvider}/${profile.settings.defaultModel}`;
  const slash = modelRef.indexOf("/"); const model = modelRuntime.getModel(modelRef.slice(0, slash), modelRef.slice(slash + 1));
  if (!model) throw new Error("The requested model is unavailable in this device's Pi configuration");
  const { session } = await createAgentSession({ cwd: workspace, agentDir, modelRuntime, model,
    thinkingLevel: request.thinkingOverride ?? profile.settings.defaultThinkingLevel, settingsManager, resourceLoader: loader,
    ...(request.toolPolicy === "read-only" ? { tools: ["read", "grep", "find", "ls"] } : {}), sessionManager: SessionManager.inMemory(workspace),
  });
  await session.bindExtensions({ mode: "print" });
  // Profile code is trusted code; this is configuration isolation, not an OS sandbox.
  // The optional read-only policy fixes the built-in tool surface and records that override.
  const normalize = (value: string) => value.split(request.runDir).join("<run>");
  const skillFiles = loader.getSkills().skills.map(s => ({ path: s.filePath, name: s.name, hash: digest(readFileSync(s.filePath)) }));
  const resourceHashes = loader.getExtensions().extensions.map(e => ({ path: normalize(e.path), hash: existsSync(e.path) ? digest(readFileSync(e.path)) : "inline" }));
  const lockfiles = walk(agentDir, new Set(["node_modules", ".git"])).filter(p => /(?:package-lock|npm-shrinkwrap)\.json$/.test(p)).map(p => ({ path: normalize(p), hash: digest(readFileSync(p)) }));
  const effective = { profile: profile.revision, systemPromptHash: digest(normalize(session.systemPrompt)),
    model: session.model, thinking: session.thinkingLevel, activeTools: session.getActiveToolNames(), tools: session.getAllTools().map(t => ({ name: t.name, description: t.description, parameters: t.parameters })),
    skills: skillFiles.map(s => s.hash), extensions: resourceHashes, locks: lockfiles, policy: request.toolPolicy,
  };
  const effectiveConfigHash = digest(normalize(canonical(effective)));
  jsonWrite(join(request.runDir, "effective.json"), { profileRevision: profile.revision, effectiveConfigHash,
    systemPromptHash: effective.systemPromptHash, modelHash: digest(canonical(effective.model)),
    toolsHash: digest(normalize(canonical(effective.tools))), activeTools: effective.activeTools,
    skills: effective.skills, extensions: effective.extensions, locks: effective.locks, toolPolicy: request.toolPolicy,
  });
  const collector = new Collector({ ...request.identity, effectiveConfigHash }, workspace, skillFiles);
  const save = (metrics: Metrics) => { jsonWrite(join(request.runDir, "metrics.json"), metrics, true); process.send?.({ type: "metrics", metrics }); };
  save(collector.finish("aborted", "aborted"));
  let lastText = ""; let timedOut = false;
  const unsubscribe = session.subscribe(event => {
    collector.observe(event, session.thinkingLevel);
    if (event.type === "message_end" && event.message.role === "assistant") {
      lastText = event.message.content.filter(c => c.type === "text").map(c => c.text).join("\n");
      save(collector.finish("aborted", "aborted"));
    }
    if (event.type === "tool_execution_end") save(collector.finish("aborted", "aborted"));
  });
  const timer = setTimeout(() => { timedOut = true; void session.abort(); }, request.timeoutSeconds * 1000);
  try {
    if (profile.settings.enableSkillCommands !== false) collector.explicitSkill(profile.workflow.prompt);
    await session.prompt(profile.workflow.prompt, { source: "rpc" });
    let metrics = collector.finish(timedOut ? "timeout" : undefined, timedOut ? "timeout" : undefined);
    if (!lastText.trim() && metrics.status === "completed") metrics = collector.finish("error", "provider");
    try { validatePacket(workspace); } catch { metrics = collector.finish("error", "workspace_changed"); }
    writeFileSync(join(request.runDir, "review.md"), lastText || "No review was produced.\n", { mode: 0o600 });
    save(metrics); return metrics;
  } catch {
    const metrics = collector.finish(timedOut ? "timeout" : "error", timedOut ? "timeout" : "provider"); save(metrics); return metrics;
  } finally { clearTimeout(timer); unsubscribe(); session.dispose(); }
}

if (process.argv[2] === "--request" && process.argv[3]) {
  const request = jsonRead(process.argv[3]) as WorkerRequest;
  try { const metrics = await executeReview(request); process.send?.({ type: "done", metrics }); }
  catch { process.send?.({ type: "failed", code: "setup" }); process.exitCode = 1; }
  finally { process.disconnect?.(); }
}
