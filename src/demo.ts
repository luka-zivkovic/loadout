import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { freezeContext } from "./context.js";
import { ensureDir, jsonWrite } from "./files.js";
import { exampleProfile, saveProfile } from "./profiles.js";
import { compareProfiles } from "./runner.js";
import { Store } from "./store.js";

/** A deterministic local provider exercises real Pi model streaming and tool execution, without a paid call. */
export async function startDemoProvider() {
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2_000_000) throw new Error("Request too large"); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const messages = body.messages ?? []; const toolMessages = messages.filter((m: any) => m.role === "tool").length;
      const thorough = JSON.stringify(messages).includes("Trace changed values");
      let path: string | undefined;
      if (toolMessages === 0) path = "PR.diff";
      else if (toolMessages === 1) path = "repo/discount.js";
      else if (toolMessages === 2 && thorough) path = "repo/caller.js";
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const chunk = (delta: unknown, finish: string | null = null, usage?: unknown) => res.write(`data: ${JSON.stringify({
        id: "demo", object: "chat.completion.chunk", created: 1, model: "fixture",
        choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}),
      })}\n\n`);
      chunk({ role: "assistant", content: "" });
      if (path) {
        chunk({ tool_calls: [{ index: 0, id: `read-${toolMessages}`, type: "function", function: { name: "read", arguments: JSON.stringify({ path }) } }] });
        chunk({}, "tool_calls", { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
      } else {
        chunk({ content: "# Scripted demo review\n\nThis is a plumbing demonstration, not a quality evaluation.\n\n- repo/discount.js:2: the change subtracts a percentage as a whole number. For a price of 100 and percent of 20, the result is -1900 instead of 80. Divide percent by 100.\n" });
        chunk({}, "stop", { prompt_tokens: 100, completion_tokens: 60, total_tokens: 160 });
      }
      res.end("data: [DONE]\n\n");
    } catch { res.writeHead(400); res.end("Invalid demo request"); }
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No demo port");
  return { url: `http://127.0.0.1:${address.port}/v1`, close: () => new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done())) };
}

export async function runDemo(out = resolve(".demo", randomUUID())) {
  const repo = join(out, "fixture"); ensureDir(repo);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
  git("init", "-q"); git("config", "user.name", "Loadout Demo"); git("config", "user.email", "demo@example.invalid");
  writeFileSync(join(repo, "discount.js"), "export function discount(price, percent) {\n  return price * (1 - percent / 100);\n}\n");
  writeFileSync(join(repo, "caller.js"), "import { discount } from './discount.js';\nexport const salePrice = discount(100, 20);\n");
  writeFileSync(join(repo, "AGENTS.md"), "Percentages are whole numbers between 0 and 100. Review correctness; do not edit code.\n");
  git("add", "."); git("commit", "-qm", "Correct discount");
  writeFileSync(join(repo, "discount.js"), "export function discount(price, percent) {\n  return price * (1 - percent);\n}\n");
  git("add", "."); git("commit", "-qm", "Introduce review fixture defect");
  const packet = join(out, "packet"); freezeContext({ repo, base: "HEAD~1", head: "HEAD", out: packet });
  const store = new Store(join(out, "store"), "work");
  const profiles = [exampleProfile("baseline", "work", "pi-share-demo/fixture"), exampleProfile("callers", "work", "pi-share-demo/fixture", true)].map(p => saveProfile(store, p));
  jsonWrite(join(out, "baseline.profile.json"), profiles[0]);
  const provider = await startDemoProvider();
  try {
    const comparison = await compareProfiles({ store, profiles, packet, demoUrl: provider.url, timeoutSeconds: 20, authDir: join(out, "no-credentials") });
    store.exportAnalytics(join(out, "metadata.json"));
    return { out, ...comparison };
  } finally { await provider.close(); }
}
