#!/usr/bin/env node
import { parseArgs } from "node:util";
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { freezeContext } from "./context.js";
import { runDemo } from "./demo.js";
import { ensureDir, jsonRead, jsonWrite } from "./files.js";
import {
  captureProfile,
  exampleProfile,
  getProfile,
  listProfiles,
  saveProfile,
  validateProfile,
} from "./profiles.js";
import { compareProfiles, formatReport, runProfile } from "./runner.js";
import { Store } from "./store.js";
import { connectTeam, loginTeam, TeamClient } from "./team-client.js";
import {
  scope as scopeSchema,
  harnessSchema,
  harnessLabels,
  setupHarness,
  type Setup,
} from "./schema.js";
import {
  captureSkill,
  getSkill,
  installSkill,
  listSkills,
  saveSkill,
  sealSkill,
  skillDestination,
  validateSkill,
  pinnedSkill,
} from "./skills.js";
import {
  addSkillToSetup,
  captureSetup,
  getSetup,
  listSetups,
  materializeSetup,
  saveSetup,
} from "./setups.js";
import { assertLocalAvailable } from "./availability.js";
import { rememberCapture, checkSources } from "./local-state.js";
import { TelemetryCheckpoint, recoverTelemetry } from "./checkpoints.js";
import { setTimeout as delay } from "node:timers/promises";

const help = `Loadout — shared skills, native harness setups, and metadata-only analytics

  skill capture DIR [--compatible pi,claude-code,codex] [--requires TEXT]
  skill list | show NAME | export NAME --out FILE | import FILE
  skill install NAME --harness pi|claude-code|codex [--project DIR | --out DIR]
  skill extract SETUP SKILL_NAME [--compatible pi,claude-code,codex]
  setup capture NAME --harness pi|claude-code|codex [--agent-dir DIR] [--project DIR]
  setup list | show NAME
  setup add-skill NAME SKILL [--as LOCAL_NAME]
  setup materialize NAME --out NEW_CONFIG_DIR
  telemetry listen SETUP [--port PORT]
  team skills REMOTE
  team publish-skill REMOTE LOCAL_SKILL [--expected REVISION]
  team pull-skill REMOTE MEMBER/SKILL [--revision HASH] [--as LOCAL_NAME]

  profile init NAME --model PROVIDER/MODEL [--thorough]
  profile capture NAME [--agent-dir DIR] [--project REPO] [--model PROVIDER/MODEL]
                       [--workflow ID] [--prompt FILE]
  profile list | show NAME
  profile export NAME --out FILE
  profile import FILE
  freeze --repo REPO --base REF --head REF --out DIR [--context DIR]
  run NAME --packet DIR [--model PROVIDER/MODEL] [--timeout SECONDS]
  compare --profiles NAME,NAME --packet DIR [--model PROVIDER/MODEL] [--repeat N]
  score RUN_ID --valid N --false N --missed N
  analytics export --out FILE
  analytics import FILE
  analytics report [--comparison UUID] [--include-demo] [--out FILE]
  registry init --data DIR --team NAME --scope work --member NAME --token-out FILE
  serve --data DIR [--team NAME --scope work] [--public-url https://share.example.com]
  registry serve --data DIR [--host 127.0.0.1] [--port 4318]
  registry setup-link --data DIR --public-url URL
  registry recovery-link --data DIR --email EMAIL --public-url URL
  registry grant --data DIR --member NAME --token-out FILE [--expires-days 90]
  registry members --data DIR | registry revoke TOKEN_UUID --data DIR
  team connect REMOTE --url URL --token-file FILE
  team login REMOTE --url URL [--label DEVICE]
  team status REMOTE | team profiles REMOTE
  team publish REMOTE LOCAL_SETUP [--expected REVISION]
  team pull REMOTE MEMBER/PROFILE [--revision HASH] [--as LOCAL_NAME]
  team sync REMOTE [--include-demo] [--watch SECONDS] [--check]
  team login REMOTE --url URL              renews the same member and remote
  team withdraw REMOTE OWNER/SETUP --revision HASH
  team withdraw-skill REMOTE OWNER/SKILL --revision HASH
  team trial REMOTE TRIAL_UUID --repo DIR --base REF --head REF [--prepare-only]
  setup check [NAME] | setup inspect NAME | skill inspect NAME
  telemetry recover                       recover interrupted counter checkpoints
  registry usage --data DIR | registry purge-withdrawn --data DIR
  registry doctor --data DIR [--public-url URL] [--trusted-proxy IP,IP]
  demo [--out DIR]        Real Pi + scripted local provider; no paid model calls

Global: --home DIR (default ~/.pi-share), --scope personal|work (default personal),
        --actor ID (use the same ID across your devices), --auth-dir DIR

Comparison runs use fresh in-memory Pi sessions and the profile's tools.
Use --tool-policy read-only to fix the tool surface to read/grep/find/ls.
Profile extensions remain trusted executable code. Review outputs stay local.
Exports contain profile files or a strict metadata schema; never raw session events.
`;
const { values: v, positionals: p } = parseArgs({
  allowPositionals: true,
  options: {
    "config-dir": { type: "string" },
    "reviewed-revision": { type: "string" },
    check: { type: "boolean" },
    "prepare-only": { type: "boolean" },
    "trusted-proxy": { type: "string" },
    help: { type: "boolean", short: "h" },
    home: { type: "string" },
    scope: { type: "string" },
    actor: { type: "string" },
    model: { type: "string" },
    "agent-dir": { type: "string" },
    "auth-dir": { type: "string" },
    project: { type: "string" },
    workflow: { type: "string" },
    prompt: { type: "string" },
    out: { type: "string" },
    repo: { type: "string" },
    base: { type: "string" },
    head: { type: "string" },
    context: { type: "string" },
    packet: { type: "string" },
    profiles: { type: "string" },
    repeat: { type: "string" },
    timeout: { type: "string" },
    thorough: { type: "boolean" },
    valid: { type: "string" },
    false: { type: "string" },
    missed: { type: "string" },
    comparison: { type: "string" },
    "include-demo": { type: "boolean" },
    "tool-policy": { type: "string" },
    data: { type: "string" },
    team: { type: "string" },
    member: { type: "string" },
    "token-out": { type: "string" },
    "token-file": { type: "string" },
    "expires-days": { type: "string" },
    host: { type: "string" },
    port: { type: "string" },
    url: { type: "string" },
    expected: { type: "string" },
    revision: { type: "string" },
    as: { type: "string" },
    watch: { type: "string" },
    "public-url": { type: "string" },
    email: { type: "string" },
    label: { type: "string" },
    harness: { type: "string" },
    compatible: { type: "string" },
    requires: { type: "string" },
    "harness-version": { type: "string" },
  },
});
const need = (value: string | undefined, name: string) => {
  if (!value) throw new Error(`Missing ${name}; see --help`);
  return value;
};
const number = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) =>
  z.coerce
    .number()
    .int()
    .min(min)
    .max(max)
    .parse(value ?? fallback);
const summary = (profile: ReturnType<typeof getProfile>) => ({
  name: profile.name,
  revision: profile.revision,
  scope: profile.scope,
  piVersion: profile.piVersion,
  settings: profile.settings,
  workflowId: profile.workflow.id,
  packages: profile.packages,
  resources: profile.resources,
  files: profile.files.map((f) => ({ path: f.path, sha256: f.sha256 })),
  requirements: profile.requirements,
  omittedSettings: profile.omittedSettings,
});
const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
const setupSummary = (setup: Setup) => ({
  ...setup,
  files: setup.files.map(({ data, ...file }) => file),
});
const skillSummary = (skill: ReturnType<typeof getSkill>) => ({
  ...skill,
  files: skill.files.map(({ data, ...file }) => file),
});

function inspectContents(artifact: Setup | ReturnType<typeof getSkill>) {
  return {
    ...artifact,
    files: artifact.files.map(({ data, ...file }) => {
      const bytes = Buffer.from(data, "base64");
      return {
        ...file,
        bytes: bytes.length,
        content: bytes.includes(0)
          ? "Binary file: inspect locally before use"
          : bytes.toString("utf8"),
      };
    }),
  };
}

async function main() {
  if (v.help || !p.length) {
    console.log(help);
    return;
  }
  if (p[0] === "serve") {
    const { Registry } = await import("./registry.js");
    const data = v.data ?? ".registry";
    const registry = new Registry(
      data,
      existsSync(join(data, "registry.sqlite"))
        ? undefined
        : {
            teamName: v.team ?? "pi-share",
            scope: scopeSchema.parse(v.scope ?? "work"),
          },
    );
    await serveDashboard(registry, data);
    return;
  }
  if (p[0] === "registry") {
    const { Registry } = await import("./registry.js");
    const data = need(v.data, "--data");
    if (["init", "grant"].includes(p[1] ?? "")) {
      const out = need(v["token-out"], "--token-out");
      const member = need(v.member, "--member");
      if (existsSync(out))
        throw new Error("Credential output already exists; choose a new file");
      const registry = new Registry(
        data,
        p[1] === "init"
          ? {
              teamName: need(v.team, "--team"),
              scope: scopeSchema.parse(v.scope ?? "work"),
            }
          : undefined,
      );
      try {
        const credential = registry.grant(
          member,
          number(v["expires-days"], 90, 1, 365),
        );
        jsonWrite(out, credential);
        console.log(
          `Credential for ${credential.actorId} in ${credential.teamName} (${credential.scope}) saved to ${resolve(out)}\nToken ID: ${credential.tokenId}`,
        );
      } finally {
        registry.close();
      }
      return;
    }
    if (p[1] === "doctor") {
      const { checkDeployment } = await import("./deployment.js");
      const report = checkDeployment(data, {
        publicUrl: v["public-url"],
        trustedProxies: v["trusted-proxy"]?.split(","),
      });
      console.log(JSON.stringify(report, null, 2));
      if (!report.ok) process.exitCode = 1;
      return;
    }
    const registry = new Registry(data);
    if (p[1] === "serve") {
      await serveDashboard(registry, data);
      return;
    }
    try {
      if (p[1] === "setup-link" || p[1] === "recovery-link") {
        const { WebAuth } = await import("./web-auth.js");
        const { publicOrigin } = await import("./web-server.js");
        const auth = new WebAuth(registry);
        const origin = publicOrigin(need(v["public-url"], "--public-url"));
        const user =
          p[1] === "recovery-link"
            ? auth
                .users()
                .find(
                  (u) =>
                    u.email === need(v.email, "--email").trim().toLowerCase(),
                )
            : undefined;
        if (p[1] === "recovery-link" && !user)
          throw new Error("Account not found");
        const result = user ? auth.resetLink(user.userId) : auth.issueSetup();
        saveAccountLink(data, user ? "reset" : "setup", origin, result);
      } else if (p[1] === "purge-withdrawn")
        console.log(JSON.stringify(registry.ops.purge("host"), null, 2));
      else if (p[1] === "usage")
        console.log(JSON.stringify(registry.ops.usage(), null, 2));
      else if (p[1] === "members")
        console.log(JSON.stringify(registry.tokens(), null, 2));
      else if (p[1] === "revoke")
        console.log(
          registry.revoke(need(p[2], "TOKEN_UUID"))
            ? "Credential revoked"
            : "Credential not active",
        );
      else throw new Error("Unknown registry command; see --help");
    } finally {
      registry.close();
    }
    return;
  }
  if (p[0] === "demo") {
    const result = await runDemo(v.out ? resolve(v.out) : undefined);
    console.log(
      `Demo comparison: ${result.report}\nMetadata export: ${join(result.out, "metadata.json")}`,
    );
    if (result.records.some((r) => r.status !== "completed"))
      process.exitCode = 1;
    return;
  }
  const store = new Store(v.home, v.scope ?? "personal");
  if (p[0] === "team") {
    const remote = need(p[2], "REMOTE");
    if (p[1] === "login") {
      const abort = new AbortController();
      const stop = () => abort.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        const identity = await loginTeam(
          store,
          remote,
          need(v.url, "--url"),
          v.label ?? hostname(),
          (request) => {
            console.log(
              `Device code: ${request.userCode}\nOpen ${request.verificationUrl}?code=${request.userCode}\nSign in and approve this code. Waiting for approval…`,
            );
          },
          abort.signal,
        );
        console.log(
          `Connected ${remote} to ${identity.teamName} (${identity.scope}) as ${identity.actorId}.\nUse team publish for a chosen setup and team sync for metadata.`,
        );
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
      return;
    }
    if (p[1] === "connect") {
      const identity = await connectTeam(
        store,
        remote,
        need(v.url, "--url"),
        jsonRead(need(v["token-file"], "--token-file")),
      );
      console.log(
        `Connected ${remote} to ${identity.teamName} (${identity.scope}). New measurements use actor ${identity.actorId}.\nUse team publish to share a chosen setup and team sync to exchange metadata.`,
      );
      return;
    }
    const client = new TeamClient(store, remote);
    if (p[1] === "status") {
      if (v.check) checkSources(store);
      console.log(JSON.stringify(await client.status(), null, 2));
      return;
    }
    if (p[1] === "withdraw" || p[1] === "withdraw-skill") {
      console.log(
        JSON.stringify(
          await client.withdraw(
            p[1] === "withdraw" ? "profile" : "skill",
            need(p[3], "OWNER/NAME"),
            need(v.revision, "--revision"),
          ),
          null,
          2,
        ),
      );
      return;
    }
    if (p[1] === "trial") {
      const trial = await client.trial(z.uuid().parse(need(p[3], "TRIAL_ID")));
      if (trial.owner !== client.actorId)
        throw new Error("Run trials under the member who created them.");
      const baseline = await client.pull(
        `${trial.baseline.owner}/${trial.baseline.name}`,
        {
          revision: trial.baseline.revision,
          alias: `trial-${trial.trialId.slice(0, 8)}-baseline`,
        },
      );
      const candidate = await client.pull(
        `${trial.candidate.owner}/${trial.candidate.name}`,
        {
          revision: trial.candidate.revision,
          alias: `trial-${trial.trialId.slice(0, 8)}-candidate`,
        },
      );
      const dir = join(store.dir, "trials", trial.trialId);
      ensureDir(dir);
      if (
        trial.kind !== "controlled" ||
        baseline.profile.schemaVersion !== 1 ||
        candidate.profile.schemaVersion !== 1
      ) {
        const prepared = [baseline, candidate].map((entry, i) => {
          const out = join(dir, i ? "candidate" : "baseline");
          if (existsSync(out)) {
            const existing = jsonRead(join(out, "pi-share-setup.json")) as {
              revision: string;
            };
            if (existing.revision !== entry.profile.revision)
              throw new Error(
                "Existing trial directory belongs to another revision; inspect it before preparing again.",
              );
          }
          const receipt = existsSync(out)
            ? null
            : materializeSetup(entry.profile, out);
          return {
            alias: entry.alias,
            revision: entry.profile.revision,
            directory: out,
            receipt,
            telemetry: `loadout telemetry listen ${entry.alias} --scope ${store.scope} --comparison ${trial.trialId} --config-dir ${shellQuote(out)}`,
          };
        });
        console.log(
          JSON.stringify(
            {
              trial: trial.name,
              capability: "observations-only",
              prepared,
              next: "Use each native configuration with its own authentication and collector. Keep the task local. Sync when finished, then return to the trial URL. These observations do not establish equal context.",
            },
            null,
            2,
          ),
        );
        return;
      }
      const packet = join(dir, "packet");
      const inputsPath = join(dir, "local-inputs.json");
      if (!existsSync(packet)) {
        const inputs = {
          repo: resolve(need(v.repo, "--repo")),
          base: need(v.base, "--base"),
          head: v.head ?? "HEAD",
          context: v.context ? resolve(v.context) : null,
        };
        freezeContext({
          repo: inputs.repo,
          base: inputs.base,
          head: inputs.head,
          out: packet,
          context: inputs.context ?? undefined,
        });
        jsonWrite(inputsPath, inputs, true);
      } else if (existsSync(inputsPath)) {
        const inputs = jsonRead(inputsPath) as {
          repo: string;
          base: string;
          head: string;
          context: string | null;
        };
        if (
          (v.repo && resolve(v.repo) !== inputs.repo) ||
          (v.base && v.base !== inputs.base) ||
          (v.head && v.head !== inputs.head) ||
          (v.context && resolve(v.context) !== inputs.context)
        )
          throw new Error(
            "This trial already has a frozen local task. Create a new trial to change its repository or refs.",
          );
      }
      if (v["prepare-only"]) {
        console.log(
          JSON.stringify(
            {
              trial: trial.name,
              packet,
              profiles: [baseline.alias, candidate.alias],
              next: "Inspect the pinned setups and local packet. Run the same team trial command without --prepare-only to execute and sync.",
            },
            null,
            2,
          ),
        );
        return;
      }
      const result = await compareProfiles({
        store,
        profiles: [baseline.profile, candidate.profile],
        packet,
        comparisonId: trial.trialId,
        authDir: v["auth-dir"],
        timeoutSeconds: number(v.timeout, 180, 1, 3600),
        repeats: number(v.repeat, 1, 1, 20),
        toolPolicy: "read-only",
      });
      await client.sync();
      console.log(formatReport(result.records));
      console.log(
        `Local report: ${result.report}\nReturn to Comparisons → ${trial.name} to assess the results.`,
      );
      if (result.records.some((r) => r.status !== "completed"))
        process.exitCode = 1;
      return;
    }
    if (p[1] === "profiles") {
      console.log(JSON.stringify(await client.profiles(), null, 2));
      return;
    }
    if (p[1] === "skills") {
      console.log(JSON.stringify(await client.skills(), null, 2));
      return;
    }
    if (p[1] === "publish-skill") {
      const artifact = getSkill(store, need(p[3], "LOCAL_SKILL"));
      if (
        v["reviewed-revision"] &&
        artifact.revision !== v["reviewed-revision"]
      )
        throw new Error(
          "Skill changed after review; inspect the current revision first.",
        );
      const result = await client.publishSkill(
        artifact,
        v.expected === "none" ? null : v.expected,
      );
      console.log(
        `${result.published ? "Published skill" : "Already published"}: ${result.revision}`,
      );
      return;
    }
    if (p[1] === "pull-skill") {
      const result = await client.pullSkill(need(p[3], "MEMBER/SKILL"), {
        revision: v.revision,
        alias: v.as,
      });
      console.log(
        `Downloaded ${result.alias}@${result.skill.revision}\nCompatible: ${result.skill.compatibleWith.map((h) => harnessLabels[h]).join(", ")}\nInstall with: loadout skill install ${result.alias} --scope ${store.scope} --harness HARNESS [--project /path/to/project]`,
      );
      return;
    }
    if (p[1] === "publish") {
      const artifact = getSetup(store, need(p[3], "LOCAL_SETUP"));
      if (
        v["reviewed-revision"] &&
        artifact.revision !== v["reviewed-revision"]
      )
        throw new Error(
          "Setup changed after review; inspect the current revision first.",
        );
      const result = await client.publish(
        artifact,
        v.expected === "none" ? null : v.expected,
      );
      console.log(
        `${result.published ? "Published" : "Already published"}: ${result.revision}`,
      );
      return;
    }
    if (p[1] === "pull") {
      const result = await client.pull(need(p[3], "MEMBER/PROFILE"), {
        revision: v.revision,
        alias: v.as,
      });
      console.log(
        `Downloaded local alias ${result.alias} at ${result.profile.revision}\n${result.profile.schemaVersion === 1 ? `Run with: loadout run ${result.alias} --scope ${store.scope} --packet /path/to/frozen-review` : `Materialize ${harnessLabels[result.profile.harness.kind]} configuration: loadout setup materialize ${result.alias} --scope ${store.scope} --out /path/to/new-config-directory`}`,
      );
      return;
    }
    if (p[1] === "sync") {
      if (v.check) checkSources(store);
      if (!v.watch) {
        console.log(
          JSON.stringify(
            await client.sync({ includeDemo: v["include-demo"] }),
            null,
            2,
          ),
        );
        return;
      }
      const interval = number(v.watch, 30, 5, 3600) * 1000;
      const abort = new AbortController();
      const stop = () => abort.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      console.log(
        `Syncing ${remote} every ${interval / 1000}s; Ctrl-C stops. Only this actor's ${v["include-demo"] ? "live and demo" : "live"} metadata is uploaded.`,
      );
      let lastCheck = Date.now();
      try {
        while (!abort.signal.aborted) {
          if (v.check && Date.now() - lastCheck >= 60_000) {
            checkSources(store);
            lastCheck = Date.now();
          }
          try {
            const result = await client.sync({
              includeDemo: v["include-demo"],
            });
            if (
              result.changes ||
              result.uploadedRuns ||
              result.uploadedAssessments ||
              result.scoreConflicts.length
            )
              console.log(JSON.stringify(result));
          } catch (error) {
            console.error(
              `Sync failed; local records retained: ${error instanceof Error ? error.message : "request failed"}`,
            );
          }
          await delay(interval, undefined, { signal: abort.signal }).catch(
            () => {},
          );
        }
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
      return;
    }
    throw new Error("Unknown team command; see --help");
  }
  if (p[0] === "skill") {
    const compatibleWith = v.compatible
      ?.split(",")
      .map((h) => harnessSchema.parse(h.trim()));
    if (p[1] === "capture") {
      const skill = saveSkill(
        store,
        captureSkill({
          dir: need(p[2], "DIR"),
          scope: store.scope,
          compatibleWith,
          requirements: v.requires ? [v.requires] : [],
        }),
      );
      console.log(JSON.stringify(skillSummary(skill), null, 2));
      return;
    }
    if (p[1] === "list") {
      console.log(
        JSON.stringify(
          listSkills(store).map(({ localName, skill }) => ({
            localName,
            ...skillSummary(skill),
          })),
          null,
          2,
        ),
      );
      return;
    }
    if (p[1] === "import") {
      const skill = saveSkill(
        store,
        validateSkill(jsonRead(need(p[2], "FILE"))),
      );
      console.log(`Imported ${skill.name}@${skill.revision}`);
      return;
    }
    if (p[1] === "extract") {
      const setup = getSetup(store, need(p[2], "SETUP"));
      const pin = setup.skillPins?.find(
        (s) => s.name === need(p[3], "SKILL_NAME"),
      );
      if (!pin)
        throw new Error(
          "This setup has no matching pinned skill; capture its SKILL.md directory directly instead",
        );
      const { revision, ...body } = pinnedSkill(pin, setup.files, setup.scope);
      const skill = saveSkill(
        store,
        sealSkill({ ...body, ...(compatibleWith ? { compatibleWith } : {}) }),
      );
      console.log(JSON.stringify(skillSummary(skill), null, 2));
      return;
    }
    const skill = getSkill(store, need(p[2], "NAME"));
    if (p[1] === "inspect") {
      console.log(JSON.stringify(inspectContents(skill), null, 2));
      return;
    }
    if (p[1] === "show") {
      console.log(JSON.stringify(skillSummary(skill), null, 2));
      return;
    }
    if (p[1] === "export") {
      jsonWrite(need(v.out, "--out"), skill);
      console.log(`Exported ${skill.name}@${skill.revision}`);
      return;
    }
    if (p[1] === "install") {
      assertLocalAvailable(store, skill);
      const harness = harnessSchema.parse(need(v.harness, "--harness"));
      const dest = v.out ?? skillDestination(skill.name, harness, v.project);
      console.log(
        `Installed ${skill.name}@${skill.revision}\n${installSkill(skill, harness, dest)}${skill.requirements.length ? `\nRequirements: ${skill.requirements.join("; ")}` : ""}`,
      );
      return;
    }
    throw new Error("Unknown skill command; see --help");
  }
  if (p[0] === "setup") {
    if (p[1] === "check") {
      console.log(JSON.stringify(checkSources(store, p[2]), null, 2));
      return;
    }
    if (p[1] === "capture") {
      const options = {
        name: need(p[2], "NAME"),
        scope: store.scope,
        harness: harnessSchema.parse(need(v.harness, "--harness")),
        agentDir: v["agent-dir"],
        project: v.project,
        workflowId: v.workflow,
        prompt: v.prompt ? readFileSync(v.prompt, "utf8") : undefined,
        model: v.model,
        version: v["harness-version"],
      };
      const setup = saveSetup(store, captureSetup(options));
      rememberCapture(
        store,
        { ...options, promptFile: v.prompt },
        setup.revision,
      );
      console.log(JSON.stringify(setupSummary(setup), null, 2));
      return;
    }
    if (p[1] === "list") {
      console.log(
        JSON.stringify(
          listSetups(store).map(({ localName, setup }) => ({
            localName,
            ...setupSummary(setup),
          })),
          null,
          2,
        ),
      );
      return;
    }
    const setup = getSetup(store, need(p[2], "NAME"));
    if (p[1] === "inspect") {
      console.log(JSON.stringify(inspectContents(setup), null, 2));
      return;
    }
    if (p[1] === "show") {
      console.log(JSON.stringify(setupSummary(setup), null, 2));
      return;
    }
    if (p[1] === "add-skill") {
      const updated = saveSetup(
        store,
        addSkillToSetup(setup, getSkill(store, need(p[3], "SKILL"))),
        v.as ?? p[2],
      );
      console.log(JSON.stringify(setupSummary(updated), null, 2));
      return;
    }
    if (p[1] === "materialize") {
      assertLocalAvailable(store, setup);
      const result = materializeSetup(setup, need(v.out, "--out"));
      console.log(JSON.stringify(result, null, 2));
      if (result.harness !== "pi")
        console.log(
          `\nLaunch from your project with:\n${result.harness === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"}='${result.directory.replace(/'/g, "'\\''")}' ${result.harness === "codex" ? "codex" : "claude"}`,
        );
      return;
    }
    throw new Error("Unknown setup command; see --help");
  }
  if (p[0] === "telemetry" && p[1] === "recover") {
    console.log(JSON.stringify(recoverTelemetry(store), null, 2));
    return;
  }
  if (p[0] === "telemetry" && p[1] === "listen") {
    const setup = getSetup(store, need(p[2], "SETUP"));
    if (setup.schemaVersion === 1)
      throw new Error(
        "Use Pi's /share-start and /share-stop extension for Pi analytics",
      );
    const { NativeTelemetry, serveTelemetry, telemetryInstructions } =
      await import("./telemetry.js");
    const collector = new NativeTelemetry(
      setup,
      store,
      v.comparison ? z.uuid().parse(v.comparison) : null,
    );
    const directory = v["config-dir"] ? resolve(v["config-dir"]) : null;
    if (directory) {
      const receipt = jsonRead(join(directory, "pi-share-setup.json")) as {
        revision: string;
      };
      if (receipt.revision !== setup.revision)
        throw new Error(
          "The exported directory does not match this pinned setup revision.",
        );
    }
    const checkpoint = new TelemetryCheckpoint(store);
    checkpoint.save([]);
    const server = await serveTelemetry(collector, {
      port: number(v.port, 0, 0, 65535),
    });
    let launch = telemetryInstructions(
      setup.harness.kind,
      server.endpoint,
      server.token,
    );
    if (directory)
      launch = `${setup.harness.kind === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"}=${shellQuote(directory)} ${launch}`;
    console.log(
      `Local ${harnessLabels[setup.harness.kind]} metadata collector for ${setup.name}.\nStart your harness in another terminal:\n\n${launch}\n\nCounters checkpoint locally every 5 seconds. Active checkpoints stay local until the collector stops. After a crash, use loadout telemetry recover.\n\nExit the harness to flush its events, then Ctrl-C here to save measurements. Run team sync separately to upload them.\nThe selected setup is an attribution label; effective configuration and task context are not verified. No raw events are retained.`,
    );
    const timer = setInterval(() => {
      try {
        checkpoint.save(collector.records());
      } catch (e) {
        console.error(`Could not persist counters: ${(e as Error).message}`);
      }
    }, 5000);
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(timer);
      await server.close();
      const records = collector.records();
      checkpoint.save(records, "stopped");
      console.log(`Saved ${records.length} local session measurements.`);
    };
    process.once("SIGINT", () => {
      void stop().catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
      });
    });
    process.once("SIGTERM", () => {
      void stop().catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
      });
    });
    return;
  }
  if (p[0] === "profile") {
    if (p[1] === "list") {
      const profiles = listSetups(store).flatMap(({ localName, setup }) =>
        setup.schemaVersion === 1 ? [{ localName, ...summary(setup) }] : [],
      );
      console.log(JSON.stringify(profiles, null, 2));
      return;
    }
    if (p[1] === "init") {
      const profile = saveProfile(
        store,
        exampleProfile(
          need(p[2], "NAME"),
          store.scope,
          need(v.model, "--model"),
          v.thorough,
        ),
      );
      console.log(JSON.stringify(summary(profile), null, 2));
      return;
    }
    if (p[1] === "capture") {
      const options = {
        name: need(p[2], "NAME"),
        scope: store.scope,
        agentDir:
          v["agent-dir"] ??
          process.env.PI_CODING_AGENT_DIR ??
          join(homedir(), ".pi/agent"),
        project: v.project,
        workflowId: v.workflow,
        prompt: v.prompt ? readFileSync(v.prompt, "utf8") : undefined,
        model: v.model,
      };
      const profile = saveProfile(store, captureProfile(options));
      rememberCapture(
        store,
        { ...options, harness: "pi", promptFile: v.prompt },
        profile.revision,
      );
      console.log(JSON.stringify(summary(profile), null, 2));
      return;
    }
    if (p[1] === "import") {
      const profile = saveProfile(
        store,
        validateProfile(jsonRead(need(p[2], "FILE"))),
      );
      console.log(`Imported ${profile.name}@${profile.revision}`);
      return;
    }
    const profile = getProfile(store, need(p[2], "NAME"));
    if (p[1] === "show") {
      console.log(JSON.stringify(summary(profile), null, 2));
      return;
    }
    if (p[1] === "export") {
      jsonWrite(need(v.out, "--out"), profile);
      console.log(`Exported ${profile.name}@${profile.revision}`);
      return;
    }
  }
  if (p[0] === "freeze") {
    const packet = freezeContext({
      repo: need(v.repo, "--repo"),
      base: need(v.base, "--base"),
      head: need(v.head, "--head"),
      out: need(v.out, "--out"),
      context: v.context,
    });
    console.log(`Frozen context ${packet.contextHash}\n${resolve(v.out!)}`);
    return;
  }
  const runOptions = {
    store,
    packet: v.packet ?? "",
    actor: v.actor,
    authDir: v["auth-dir"],
    comparisonId: v.comparison ? z.uuid().parse(v.comparison) : undefined,
    modelOverride: v.model,
    timeoutSeconds: number(v.timeout, 180, 1, 3600),
    toolPolicy: z
      .enum(["profile", "read-only"])
      .parse(v["tool-policy"] ?? "profile"),
  };
  if (p[0] === "run") {
    need(v.packet, "--packet");
    const record = await runProfile({
      ...runOptions,
      profile: getProfile(store, need(p[1], "NAME")),
    });
    console.log(formatReport([record]));
    console.log(
      `Local review: ${join(store.dir, "runs", record.runId, "review.md")}`,
    );
    if (record.status !== "completed") process.exitCode = 1;
    return;
  }
  if (p[0] === "compare") {
    need(v.packet, "--packet");
    const profiles = need(v.profiles, "--profiles")
      .split(",")
      .map((ref) => getProfile(store, ref));
    const result = await compareProfiles({
      ...runOptions,
      profiles,
      repeats: number(v.repeat, 1, 1, 20),
    });
    console.log(formatReport(result.records));
    console.log(`Report: ${result.report}`);
    if (result.records.some((r) => r.status !== "completed"))
      process.exitCode = 1;
    return;
  }
  if (p[0] === "score") {
    const runId = z.uuid().parse(need(p[1], "RUN_ID"));
    const record = store.records().find((r) => r.runId === runId);
    if (!record || record.status !== "completed")
      throw new Error("Score only a completed local/imported run");
    const event = store.score(runId, store.identity(v.actor).actorId, {
      validFindings: number(need(v.valid, "--valid"), 0, 0, 10000),
      falsePositives: number(need(v.false, "--false"), 0, 0, 10000),
      missedKnownIssues: number(need(v.missed, "--missed"), 0, 0, 10000),
      evaluator: "human",
    });
    console.log(
      `Scored ${runId}; assessment ${event.eventId} supersedes ${event.parents.length} prior version(s). Sync to share this assessment.`,
    );
    return;
  }
  if (p[0] === "analytics") {
    if (p[1] === "export") {
      console.log(
        `Exported ${store.exportAnalytics(need(v.out, "--out"))} metadata records`,
      );
      return;
    }
    if (p[1] === "import") {
      console.log(
        `Imported ${store.importAnalytics(need(p[2], "FILE"))} new metadata records`,
      );
      return;
    }
    if (p[1] === "report") {
      const records = store
        .records()
        .filter(
          (r) =>
            (v["include-demo"] || r.mode === "live") &&
            (!v.comparison || r.comparisonId === v.comparison),
        );
      const report = formatReport(records, store.assessments());
      if (v.out) {
        jsonWriteGuard(v.out);
        writeFileSync(v.out, report, { mode: 0o600, flag: "wx" });
        console.log(resolve(v.out));
      } else console.log(report);
      return;
    }
  }
  throw new Error("Unknown command; see --help");
}
function jsonWriteGuard(path: string) {
  ensureDir(resolve(path, ".."));
}
function saveAccountLink(
  data: string,
  kind: "setup" | "reset",
  origin: string,
  result: { token: string; expiresAt: string },
) {
  const path = resolve(data, `${kind}-link.txt`);
  writeFileSync(path, `${origin}/${kind}#token=${result.token}\n`, {
    mode: 0o600,
  });
  chmodSync(path, 0o600);
  console.log(
    `Private ${kind} link saved to ${path}\nExpires ${result.expiresAt}. Open the link in your browser.`,
  );
}
async function serveDashboard(
  registry: import("./registry.js").Registry,
  data: string,
) {
  const { serveRegistry } = await import("./registry.js");
  const { WebAuth } = await import("./web-auth.js");
  try {
    const running = await serveRegistry(registry, {
      host: v.host ?? "127.0.0.1",
      port: number(v.port, 4318, 1, 65535),
      publicUrl: v["public-url"],
      trustedProxies: v["trusted-proxy"]?.split(","),
    });
    console.log(
      `Loadout: ${registry.metadata.teamName} (${registry.metadata.scope})\nDashboard: ${running.origin}`,
    );
    const auth = new WebAuth(registry);
    if (auth.setupRequired())
      saveAccountLink(data, "setup", running.origin, auth.issueSetup());
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void running.close().finally(() => registry.close());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    registry.close();
    throw error;
  }
}
main().catch((error) => {
  console.error(
    `loadout: ${error instanceof Error ? error.message : "Operation failed"}`,
  );
  process.exitCode = 1;
});
