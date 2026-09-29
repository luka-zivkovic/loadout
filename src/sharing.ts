/** Shared product copy for the dashboard and copied harness instructions. */
export const sharingDisclosure = {
  summary:
    "Share reusable skills, native harness setups, and usage metadata with your team. Session traces and task content stay local.",
  sections: [
    {
      title: "Shared setups",
      body: "When published: standalone skill instructions and supporting files; Pi, Claude Code, or Codex settings, reusable workflows, pinned skills, prompt templates, global harness instructions, hooks, plugin/MCP definitions, extensions, and bundled files. Native settings omit credentials, telemetry destinations, and local account state.",
    },
    {
      title: "Usage metadata",
      body: "When synced: member and device IDs, harness and version, workflow/model/tool names, declared skill versions and observed skill names, timestamps, durations, available token counts and estimated spend, measurement coverage, and human assessment counts. Device reports include sync time, configuration-check counts/time, and collector state; source paths stay local. Named trials, their selected revisions and decisions, and skill usefulness feedback are shared with the workspace.",
    },
    {
      title: "Stays local",
      body: "Loadout’s analytics sync does not upload conversations, task messages, tool arguments or outputs, repository files or diffs, frozen task context, or generated reviews.",
    },
    {
      title: "Workspace access",
      body: "Published setups and synced measurements are visible to workspace members. All active members can see account names, member handles, and optional job titles and company teams in the People directory. The workspace also stores your email and device label; the default device label is your computer’s name. Admins can inspect access/device records and administrative events.",
    },
  ],
  controls:
    "Connecting registers your device. Publishing setups and syncing measurements are separate actions. Watch sync sends saved measurements while it is running.",
  note: "Published setup files are shared as content: keep task-specific code, notes, and credentials out of them. Work/personal scope separates stores; it does not remove content from included files.",
} as const;

export function sharingDisclosureText(): string {
  return [
    "What’s shared with your workspace",
    sharingDisclosure.summary,
    ...sharingDisclosure.sections.map(({ title, body }) => `${title}: ${body}`),
    sharingDisclosure.controls,
    sharingDisclosure.note,
  ].join("\n\n");
}
