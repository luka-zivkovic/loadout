# Loadout design

Loadout (formerly Pi Share) uses [Doom 64 from tweakcn](DOOM-64.md), applied on 2026-09-11. The Open Design prototype below is preserved as the earlier visual reference.

# Earlier Open Design redesign

This design was created in the installed **Open Design** desktop application on 2026-09-09 and then adapted into the working React dashboard.

## Editable source

Open Design project: **Pi Share Dark Console Prototype**

Project ID: `f14ad5e5-125e-438e-83ab-51feeb8b2f49`

The app's editable project lives at:

`~/Library/Application Support/Open Design/namespaces/release-stable/data/projects/f14ad5e5-125e-438e-83ab-51feeb8b2f49/`

The source is also preserved here:

- [Interactive prototype](opendesign/index.html)
- [Design system and implementation mapping](opendesign/DESIGN-SYSTEM.md)
- [Original design CSS](opendesign/styles.css)
- [Prototype interactions](opendesign/app.js)

Open `index.html` in Open Design or serve this folder locally:

```sh
python3 -m http.server 4320 --bind 127.0.0.1 --directory design/opendesign
```

Choose **Explore sample workspace**. The prototype contains invented, labeled sample data and simulated account actions; it is an editable visual reference. It has no production authentication. The explicit sample entry was added to both source copies during review because Open Design's embedded preview did not submit its sample sign-in form. It also lets viewers explore without entering any password.

## Implementation

`web/design-tokens.css` contains the tokens extracted from Open Design's stylesheet: near-black charcoal surfaces, restrained lime accents, IBM Plex Sans/Mono, a 4px spacing scale, and subtle 4–8px corners. `web/styles.css` adapts the design to the application's existing component structure.

The implementation includes all six workspace views and the setup/sign-in/invitation/reset forms. Setup inspection uses a right-side drawer; comparison results remain in a focused dialog; account actions use compact dialogs. Below 1024px, the sidebar becomes a keyboard-accessible navigation drawer. Shared setups add model and workflow filters and a clear-filters empty state.

The React app keeps its actual server data, immutable revisions, authentication, device pairing, and analytics contracts. None of the prototype's sample values or simulated authentication code are imported into it. Auth flows render only applicable fields. IBM Plex fonts are bundled locally with Fontsource; the server serves font MIME types under its existing same-origin security policy.

## Verification

- TypeScript checks and production build passed.
- All 27 existing automated tests passed, including an added real built-font response/MIME check within the SPA-serving test.
- Reviewed the generated prototype in the installed Open Design app and the exported local browser preview.
- Visually checked the live overview, setup inspection drawer, comparisons, invitation dialog, and sign-in.
- Checked setup search, workflow/model filters, no-results recovery, pinned-command copying, live/demo filtering, the seven-day summary, and keyboard close/focus restoration.
- Checked mobile navigation and the overview at 390 × 844; no document-level horizontal overflow. Wide data tables retain their own horizontal scroll areas.
- Existing QA analytics remain 3 live runs, 24 tool calls, and $0.0429208 in estimated review usage.
- No new model reviews, real team invitations, or device credentials were created during this design pass.

The before-redesign UI snapshot is stored in the ignored `.demo/opendesign-before/` directory. The local QA database remains `.demo/dashboard/registry.sqlite`; normal Pi configuration and the production `.registry` are unchanged.
