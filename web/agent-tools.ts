// Optional progressive enhancement. Authentication and privileged account actions
// remain human browser flows; these tools expose only the visible analytics UI.
type Context = {
  registerTool(
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown | Promise<unknown>;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
};
export function registerDashboardTools(actions: {
  navigate: (path: string) => void;
  summary: () => unknown;
}) {
  const context = (document as Document & { modelContext?: Context })
    .modelContext;
  if (!context?.registerTool) return () => {};
  const lifecycle = new AbortController();
  const tools = [
    {
      name: "read_pi_share_summary",
      title: "Read visible team analytics",
      description:
        "Read the aggregate metrics for the currently displayed period and live/demo filter. No conversation content or credentials are returned.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute(input: unknown) {
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).length
        )
          throw new Error("Expected an empty object.");
        return actions.summary();
      },
    },
    {
      name: "navigate_pi_share",
      title: "Open a Loadout analytics view",
      description:
        "Navigate to overview, shared setups, shared skills, activity, or comparisons. This changes the visible view and performs no server mutation.",
      inputSchema: {
        type: "object",
        properties: {
          view: {
            type: "string",
            enum: ["overview", "setups", "skills", "activity", "comparisons"],
          },
        },
        required: ["view"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).length !== 1
        )
          throw new Error("Provide a view.");
        const view = (input as { view: unknown }).view;
        const routes: Record<string, string> = {
          overview: "/",
          setups: "/setups",
          skills: "/skills",
          activity: "/activity",
          comparisons: "/comparisons",
        };
        if (typeof view !== "string" || !Object.hasOwn(routes, view))
          throw new Error("Unknown view.");
        actions.navigate(routes[view]);
        return { view };
      },
    },
  ];
  for (const tool of tools) {
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Unsupported experimental implementations do not affect the dashboard. */
    }
  }
  return () => lifecycle.abort();
}
