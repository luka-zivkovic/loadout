# Loadout — Doom 64

Service logos and their official sources are documented in [the brand asset notes](../web/assets/brands/README.md). Loadout has its own separate mark.

The dashboard uses [tweakcn's Doom 64 theme](https://tweakcn.com/r/themes/doom-64.json), imported on 2026-09-11 with:

```sh
pnpm dlx shadcn@latest add https://tweakcn.com/r/themes/doom-64.json --yes
```

`components.json` points the theme registry at `web/doom-64.css`. Its light/dark values are preserved; the dashboard selects dark mode in `web/index.html`. Tailwind-only `@theme` and `@custom-variant` directives were removed because this application uses ordinary CSS, not Tailwind. Repeat that adaptation if importing the theme again. The project still uses npm and package-lock.json.

## Implementation

- `web/doom-64.css`: upstream colors, typography, zero-radius geometry and shadow tokens.
- `web/design-tokens.css`: application aliases and semantic states. Red actions are slightly darkened for white-label contrast; focus and text links use blue, success uses green.
- `web/styles.css`: shared component structure and responsive behavior.
- `web/doom-console.css`: numbered navigation, grid backdrop, large mastheads, joined metric panels, setup registry rows, skill cards, dialogs and forms.
- Oxanium and Source Code Pro are bundled locally through Fontsource.

The setup registry exposes harness tabs with real counts, search, workflow/model filters, revision/owner metadata, pinned skill counts and a detail drawer. Counts come from the existing dashboard API. Its catalogue controls are separate from the analytics time-period filter. Skills retain that filter because their details include usage measurements.

The earlier [Open Design prototype](opendesign/index.html) remains an editable historical reference. The Doom revision was implemented directly in the application.

## Validation

- TypeScript checks and production build pass, with no CSS compilation warnings.
- All 37 existing automated tests pass, including authentication, native setup/skill exchange, metadata privacy and built SPA/font serving.
- Browser checks cover setup harness/search filtering, the no-results state, setup inspection, Escape/focus restoration, publishing instructions, native skill installation choices, overview and connected devices.
- The setup registry, overview and navigation were visually reviewed at the normal desktop viewport and the 390 × 844 mobile breakpoint. Mobile styles keep table overflow within its own scroll region.

The design changes do not alter sharing, authentication or sync contracts.
