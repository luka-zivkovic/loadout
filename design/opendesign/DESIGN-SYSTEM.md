# Pi Share — Dark Console

Design-system specification for the Pi Share web app. This document pairs with
`index.html`, `styles.css`, and `app.js` in the same folder: the stylesheet is
the source of truth for values, this file explains intent and gives the
mapping back to the existing React components in `web/App.tsx`,
`web/Views.tsx`, and `web/shared.tsx`.

Everything shown in the prototype is **sample data**. Metric values, chart
bars, costs, durations, assessments, names, revisions, and links are
illustrative and are labelled as such in the UI. None of them are
measurements.

---

## 1. Direction

**Dark developer console.** Near-black charcoal surfaces in three elevation
steps, hairline borders, crisp readable type, one electric lime accent used
sparingly, dense but well-spaced data. The product should read as a serious
internal tool, not a marketing site.

Explicitly avoided: gradients of any kind, purple, glass and glow effects,
oversized radii, decorative fake terminal text, hand-drawn illustration,
invented benchmarks.

Rationale: Pi Share is self-hosted, metadata-only, and used by engineers
reviewing harness configurations and comparison results. The interface
should defer to the data and to monospace identifiers (revisions, hashes,
commands), which is what the team actually reads.

---

## 2. Tokens

All tokens are CSS custom properties on `:root` in `styles.css`. Implement
them once in the React app's global stylesheet and reference them everywhere;
never hard-code a colour or size in a component.

### 2.1 Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0B0D10` | Page ground, inputs, code blocks |
| `--surface-1` | `#111418` | Sidebar, panels, drawers, modals |
| `--surface-2` | `#171B21` | Secondary buttons, nested cards, notices |
| `--surface-3` | `#1E232B` | Selected segment, badges, avatars, meter track |
| `--surface-hover` | `#1A1F26` | Table row hover |
| `--border` | `#262C35` | Default hairline |
| `--border-strong` | `#343C48` | Inputs, buttons, emphasised edges |
| `--text` | `#E6EAF0` | Primary text |
| `--text-muted` | `#9AA4B2` | Secondary text, labels |
| `--text-faint` | `#7C8794` | Eyebrows, table headers, notes (≥ 4.5:1 on surface-1) |
| `--accent` | `#B6F04A` | Primary button fill, selected nav bar, links, meters, "connected" |
| `--accent-strong` | `#C9FF5E` | Primary hover, focus ring |
| `--accent-ink` | `#0B0D10` | Text on accent fill |
| `--accent-soft` | `rgba(182,240,74,.12)` | Selected row, green badge fill, approval card |
| `--accent-line` | `rgba(182,240,74,.35)` | Green badge border, success notice border |
| `--amber` | `#F2B84B` | Aborted, expired, context differs, warnings |
| `--red` | `#F26D6D` | Failed, revoked, disabled, errors, destructive buttons |
| `--focus` | `#C9FF5E` | Focus ring |

Contrast (checked while writing): `--text` on `--bg` ≈ 17:1, `--text-muted`
on `--surface-1` ≈ 8:1, `--text-faint` on `--surface-1` ≈ 5:1, `--accent-ink`
on `--accent` ≈ 14:1, `--amber` and `--red` on `--surface-1` > 6:1. There is
no light mode; the palette is authored for dark only.

Colour is never the only carrier of status: every status badge pairs its
colour with an icon (check, x, clock, alert) and a text label.

### 2.2 Typography

| Token | Value |
|---|---|
| `--font-ui` | `"IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif` |
| `--font-mono` | `"IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace` |

Plex Sans replaces Inter for UI text; Plex Mono carries every identifier the
team copies or compares (revisions, hashes, run ids, commands, device codes,
scope labels). Loaded from Google Fonts in the prototype; self-host the two
families (weights 400/500/600 sans, 400/500 mono) in the app.

Scale (px) and use:

| Token | Size | Line height | Use |
|---|---|---|---|
| `--fs-xs` | 12 | 1.45 | eyebrows, table headers, badges, hints, notes |
| `--fs-sm` | 13 | 1.5 | table cells, secondary copy, notices |
| `--fs-base` | 14 | 1.5 | body UI text, buttons, nav |
| `--fs-body` | 16 | 1.5–1.65 | ledes, panel h2, card h3 |
| `--fs-lg` | 18 | 1.25 | drawer/modal titles, comparison numerals |
| `--fs-xl` | 22 | 1.25 | device code display |
| `--fs-2xl` | 28 | 1.25 | page h1, metric values |
| `--fs-3xl` | 36 | 1.25 | auth story headline |

Weights: 400 regular, 500 medium (buttons, nav, labels), 600 semibold
(headings, values). Numeric cells and values use `font-variant-numeric:
tabular-nums`.

Eyebrow: 12px, 500, uppercase, `0.08em` tracking, `--text-faint`. Table
headers use the same treatment at `0.06em`.

### 2.3 Spacing

4px unit. Tokens `--s-1` (4) through `--s-16` (64): 4, 8, 12, 16, 20, 24, 32,
40, 48, 64. Density tier is **standard**: panel padding 16–20, page gap 24,
content padding 32 desktop / 20 mobile, section gaps 24.

### 2.4 Shape and elevation

| Token | Value | Use |
|---|---|---|
| `--r-sm` | 4px | badges, code, focus ring corners |
| `--r-md` | 6px | buttons, inputs, notices, nav items |
| `--r-lg` | 8px | panels, cards, modals |
| `--r-pill` | 999px | prototype chips only |
| `--shadow-modal` | `0 24px 64px rgba(0,0,0,.6)` | drawer, modal, toast |
| `--inset-highlight` | `inset 0 1px 0 rgba(255,255,255,.03)` | panels |

Elevation is expressed by surface step and hairline, not shadow. Shadow is
reserved for overlays.

### 2.5 Motion

| Token | Value | Use |
|---|---|---|
| `--t-state` | 150ms ease-out | hover, focus, colour, tooltip |
| `--t-enter` | 200ms ease-out | drawer/modal enter, off-canvas nav |
| `--t-exit` | 130ms ease-in | reserved for exit transitions |

Only `transform` and `opacity` animate. `prefers-reduced-motion: reduce`
disables all transitions and animations.

### 2.6 Layout

| Token | Value |
|---|---|
| `--sidebar-w` | 240px |
| `--topbar-h` | 52px |
| `--content-max` | 1280px |
| `--control-h` | 36px |

Breakpoints: 1440 (content capped at 1280), 1280 (metrics 4 → 2 columns),
1024 (sidebar becomes off-canvas, chart and device grids stack, auth stacks),
768 (heading stacks, toolbar wraps, tighter padding), 480 (metrics 1 column).
Mobile never scrolls horizontally; tables scroll inside `.table-wrap`.

---

## 3. App shell

```
.workspace  (grid: 240px | 1fr)
├── .sidebar  sticky, surface-1, right hairline
│   ├── .brand              π mark on accent, "pi share."
│   ├── .workspace-id       letter tile + name + "scope · reviews" (button → scope switch)
│   ├── .nav-caption + .nav six .nav-item links
│   ├── .privacy-note       shield + "Metadata, shared."
│   └── .account            avatar, name, role, sign-out icon button
└── .workspace-main
    ├── .topbar  sticky, blurred bg, breadcrumb "acme-eng / Page", self-hosted label
    └── .content (max 1280) → .page-heading, .toolbar, panels…, .content-footer
```

Navigation: `aria-current="page"` on the active item renders a 2px accent bar
on the left edge and `--surface-3` fill. Below 1024px the sidebar slides in
from the left over a scrim; the topbar shows a menu button with
`aria-expanded`; Escape and scrim click close it. Nav position never changes
between pages.

Back behaviour: the prototype stores scroll position per page and restores it
on return, and moves focus to the page `h1` (`tabindex="-1"`) on navigation.

---

## 4. Components

### Buttons
- `.button.primary` accent fill, dark ink, hover `--accent-strong`. One
  primary per viewport region.
- `.button.secondary` surface-2 fill, strong border.
- `.button.ghost` transparent, muted text; used for Cancel.
- `.button.danger` transparent with red border and text; destructive actions
  always sit behind a confirm dialog.
- `.text-button` accent inline action (Inspect, Compare, View all);
  `.text-button.quiet` muted variant for row management actions.
- `.icon-button` 36×36; `.bordered` variant in toolbars.
- Height 36px, radius 6, 500 weight. Disabled: 50% opacity, `not-allowed`.

### Segmented control
`.segmented` with `aria-pressed` buttons; selected segment gets surface-3 and
an inset hairline. Used for Live / Demo activity.

### Inputs
Height 36, `--bg` fill, strong border, accent border on focus. Every input has
a visible `<label>`; required fields show an amber asterisk. Hints sit below in
12px faint. Errors render beside the field in red with an alert icon and say
what to do, validated on submit or blur, never per keystroke. Device code
input is mono, 18px, 0.12em tracking, auto-formats `XXXXX-XXXXX`.

### Badges
22px, 12px text, radius 4. Neutral (surface-3), `.green`, `.amber`, `.red`
each with soft fill and 35% border. Status badges include an icon. `.mono`
for extension tags.

### Sample-data tag
`.sample-tag` dashed hairline chip, 12px, faint. Attached to every panel,
metric note, chart, link, or value that is invented for the prototype.

### Panels
`.panel` surface-1, hairline, radius 8, inset highlight. `.panel-heading`
(h2 16/600 + `.sub` 13 faint + optional icon or action) with bottom hairline;
`.panel-body` 20px padding.

### Metric cards
`.metric` label row (13 muted + faint icon), value 28/600 tabular, note 12
faint. Four across ≥1280, two ≥480, one below.

### Chart
Inline SVG bar chart, `viewBox 640×200`, one series. Bars accent (live) or
muted grey (demo) so the demo mode is visibly different. Three gridlines with
y labels, three x labels (start, middle, end), `<title>` per bar and a
mono tooltip on hover, an `sr-only` description with total and peak for
screen readers. No smoothing, no area fill, no second axis.

### Meters
`.meter` 6px track surface-3, accent fill; used for tool usage share. Each
row is `code` name + tabular count.

### Tables
13px cells, 12px uppercase faint headers, hairline rows, hover surface-hover,
`.selected` row accent-soft. Stacked cells use `.od-stat` (name over 12px
mono sub-line). Numeric columns right-aligned with `.num`. Every table sits
inside `.table-wrap` for horizontal overflow on narrow screens.

### Notices
`.notice` neutral, `.notice.warn` amber, `.success` green, `.error` red;
icon + text, 13px. `.local-note` is the privacy statement variant with a
shield icon and bold lead sentence.

### Drawer (setup inspect)
`<dialog class="drawer">` 560px right-anchored, full height, surface-1, left
hairline, modal shadow, slide-in 200ms. Head: eyebrow + title + close.
Body scrolls. Closes on Escape, scrim click, or close button; focus returns
to the triggering Inspect button.

### Modal (compare, invite, link, confirm)
`<dialog class="modal">` 880px (`.narrow` 480px), centred, radius 8. Same
head pattern. Comparison modal lays `.comparison-card`s two-across (one
column below 1024).

### Comparison card
Surface-2, radius 8. Title + mono sub-line + status badge; `dl` of four
numerals (Duration, Estimated cost, Tool calls, Observed skills) at 18/600
with 12px captions; model line; mini tool meters; context / revision codes;
human assessment scores (valid · false positives · missed) with the scorer's
badge, or "Not scored".

### Steps list
`.steps` numbered circles (mono, surface-3) for the device pairing
instructions.

### Toast
Bottom-centre, surface-3, hairline, 13px, check icon; 2.2s; `role="status"`.

### Skeleton
`.skeleton` shimmer for waits over 300ms (not exercised by the prototype's
instant sample data; included for implementation).

---

## 5. Screens

### Sign-in (`#screen-auth`)
Two columns (5:7): story aside on surface-1 with brand, eyebrow, 36px
headline, three feature lines with accent icons, and the privacy footer;
form column with the scope label, eyebrow, h1, lede, form, footnote, and
"Self-hosted · Invitation only · Built for Pi". Stacks below 1024.

The four real auth modes share this artboard; the prototype's chip row at the
bottom switches between them and is not product UI:

| Mode | Fields | Copy intent |
|---|---|---|
| Sign in | email, password | "Welcome back". No sign-up link; admins issue access. |
| First-admin setup | installation key, full name, email, member handle, password (≥12) | Protected bootstrap: only the installation key holder can create the first admin; the key is spent on success. |
| Invitation | full name, password (≥12) | "You're invited"; states the invited email; the user chooses their own password, admins never see it. |
| Password reset | new password (≥12) | "Account recovery"; states that reset also disconnects devices. |

### Overview
Heading + "Connect a harness" primary → My devices. Toolbar: Live/Demo
segmented, period select (7/30/90), refresh. Demo mode shows the isolation
notice and greys the chart. Four metrics (Runs shared, Estimated spend, Tool
calls, Shared setups), Workflow activity chart, Tool usage meters, Recently
shared setups table (setup names open the inspect drawer).

### Shared setups
Library panel with count, search (name, owner, model, workflow), workflow
and model selects. Columns: Setup (with skills/extensions/pi version
sub-line), Owner, Revision (mono, immutable, full hash on hover), Model (with
provider and thinking sub-line), Workflow badge, Last shared, Inspect. Empty
state explains and offers "Clear search and filters".

Inspect drawer: detail grid (model, thinking, workflow, runtime, full
revision, last shared), pull command with **Copy pull command**, workflow
instructions, skills and extensions, local requirements, bundled files and
configuration disclosures, and the executable-extensions warning.

### Activity
Runs table with selection checkboxes (2–4), status badges, duration, tool and
skill counts, estimated spend. Compare button opens the comparison modal for
the selection.

### Comparisons
Local-data statement at the top of the page. Experiments table: id, setup
badges, run count, context badge (**Frozen context matches** green /
**Context differs** amber), scored count, Compare. Modal: match banner,
model-difference notice, local-data note, "no winner inferred" line, and the
side-by-side cards.

### My devices (device pairing)
Two panels: **Connect through your harness** (three numbered steps, the
login command, Copy) and **Approve a device** (code input → approval card
showing device label, large code, expiry, Approve / Deny → success notice).
Below: **Your connected devices** list with Connected / Expired / Revoked
badges, last-active and expiry in mono, and Revoke → confirm dialog with a
red destructive button.

### Team & access (invitations)
Members table (name + email, mono handle, role badge, Active / Disabled
badge, Make admin / Disable / Reset link actions; the current user's own
role and status actions are disabled). Pending invitations table (recipient,
handle, role, expiry, Revoke). **Invite teammate** opens the invite modal
(email, handle with format hint, role select with one-line role
descriptions) → **Invitation link ready** modal showing the single-use link,
Copy private link, and the note that no email is sent. **Reset link** on a
member opens the same link modal in the Password reset variant (24-hour
expiry, disconnects devices).

Role changes, enable/disable, and revocations always pass through the
confirm dialog with copy that states the consequence.

---

## 6. Accessibility and interaction rules

- Semantic landmarks: `aside` navigation, `header` topbar, `main` content,
  `footer`, `section` panels labelled by their heading ids, native
  `<dialog>` overlays with `aria-labelledby`.
- Focus ring 2px `--focus` with 2px offset on every interactive element;
  inputs swap to an accent border. Focus order follows DOM order; page
  changes move focus to the page heading; dialogs return focus to their
  trigger.
- Hover styles live under `@media (hover: hover)` only.
- Status never relies on colour alone.
- Chart has a text description; meters have `aria-label`s.
- Buttons and links are 36px tall; table row actions are text buttons with a
  28px minimum height and adequate spacing.
- Copy actions announce through the toast (`role="status"`).

---

## 7. Mapping to the existing React app

| Existing class / component | Prototype equivalent | Notes |
|---|---|---|
| `.workspace`, `.sidebar`, `.workspace-main`, `.topbar`, `.content` | same names | Add `.nav-backdrop`, `.menu-toggle`, `.crumbs`, `.topbar-right`. |
| `Brand` (`.brand`, `.brand-icon`) | `.brand`, `.brand-mark` | Mark becomes an accent tile. |
| `.workspace-name` | `.workspace-id` (button) | Now a button that can open a scope switcher. |
| `.nav-item.active` | `.nav-item[aria-current="page"]` | Use `aria-current` instead of a class. |
| `.privacy-note`, `.account`, `.avatar` | same | |
| `.page-heading`, `.eyebrow`, `.muted` | same, plus `.lede` | |
| `.toolbar`, `.segmented`, `.toolbar-right` | same; segmented uses `aria-pressed` | |
| `.notice`, `.success`, `.error` | same, plus `.notice.warn`, `.local-note` | Add leading icon. |
| `.metric-grid`, `.metric` | same; value in `.value`, note in `.note` | |
| `.chart-grid`, `.chart`, `.chart-bars`, `.bar-column` | `.chart` with inline SVG | Replace div bars with the SVG in `renderChart` (app.js). |
| `.tool-list`, `.tool-row`, `.meter` | same | |
| `.table-wrap`, `table`, `.table-sub` | same; `.table-sub` → `.od-stat > .sub` | |
| `.badge`, `.badge.green/.amber/.red` | same + icon child | |
| `.button.primary/.secondary/.danger/.full` | same + `.ghost`, `.small` | |
| `.text-button`, `.icon-button` | same + `.quiet`, `.bordered` | |
| `Field` (`.field`) | `.field` with `.label`, `.hint`, `.field-error` | Error element replaces the generic `ErrorBox` for field-level errors. |
| `Modal` (`dialog.modal-backdrop > section.modal`) | `dialog.modal` / `dialog.drawer` | Drawer variant for setup inspect; keep `showModal()` and Escape handling. |
| `Copy` | `[data-copy]` button + toast | Same clipboard behaviour and manual-copy fallback. |
| `.search-row`, `.search` | `.search-row`, `.search-field` | Adds workflow/model selects. |
| `.detail-grid`, `.section-title`, `.tag-list` | same | |
| `.comparison-cards`, `.comparison-card` | `.comparison-grid`, `.comparison-card` | Adds tool meters and captions. |
| `.device-card`, `.approval`, `.device-code` | `.device-card`, `.approval`, `.device-code-input` | Adds `.steps`. |
| `.empty`, `.inline-empty`, `.quiet-empty` | `.empty`, `.inline-empty` | |
| `Empty`, `ErrorBox` | unchanged API | Restyle only. |
| `.od-*` primitives | copy the `@layer od-layout` block | Structure-only helpers; keep as the first rule set. |

Behavioural notes for implementation:
- Keep the existing `routes` array; render icons from Lucide at
  `strokeWidth={1.5}` and `size={18}` in nav, `16` in buttons, `14` in
  badges.
- `mode` and `days` state map directly to the segmented control and select.
- Setup search extends the current filter with workflow and model selects.
- The comparison modal's banner logic is the existing `Compare` component's
  logic; only the copy and layout change.
- Everything labelled `.sample-tag` in the prototype is removed in the app
  because the app renders real metadata.
