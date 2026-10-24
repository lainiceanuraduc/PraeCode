# Changelog

## 0.1.24

- **The project is now branded `PraeCode`**, published as `lainiceanuraduc.praecode`, display name
  "PraeCode - Hermes Agent". Microsoft keeps the deleted listing's slug (`radcode-hermes`) *and* its
  display name (`RadCode — Hermes Agent`) reserved and refuses any package reusing either, so the
  name had to change rather than the version. The brand also avoids the unrelated `radcode.co`
  software agency. Commands, `radcode.*` setting ids, icon and behaviour are unchanged; the palette
  titles, output channel, view container and the README now say PraeCode.
- Fixed the settings command opening `@ext:radcode-local.radcode-hermes`, a publisher id that never
  matched this extension; it now targets the real one.
- No functional changes: 0.1.24 is 0.1.23 (model picker, resizable prompt, profile editor, CC0 font)
  plus the rename.

## 0.1.23

- **Removed the bundled Valve font (licence fix).** `Valve-Bold.otf`/`Valve-BoldItalic.otf` are
  Typodermic Fonts software under a Desktop EULA whose §4 explicitly forbids use in "an app, game,
  desktop application, plug-in, extension, mod, or other software" and forbids distributing the font
  files. Shipping them inside the VSIX was a licence violation, so they no longer ship.
- **The display face is now Public Pixel by GGBotNet (CC0 1.0, public domain)**, which permits
  redistribution in a published extension. It styles buttons, tabs, the HERMES wordmark and the
  session title — message text, prompts and replies keep following `radcode.fontFamily`.
- Dropped the unused Pixelzone files (CC0, unreferenced since the 0.1.20 type-scale change); the
  extension is ~360 KB smaller.
- Added `media/fonts/PublicPixel.LICENSE.txt` and a README section recording provenance, so the
  licence situation of every bundled binary is stated rather than assumed.

## 0.1.22

- Model button opens a picker modal: a Favorites list persisted by the extension and, per provider,
  every model Hermes offers. Starring a model adds it, starring it again in Favorites removes it.
- The modal shows the selected model's real details: provider, publishing lab, context window (with
  its source) and the exact thinking/effort ladder resolved for that provider and model.
- The prompt input has a grab bar above it: drag or arrow-key to resize, remembered per webview.
- Features now shows the Hermes profile itself — `SOUL.md`, `memories/USER.md` and
  `memories/MEMORY.md` — each editable with an explicit Save, written atomically and allowlisted to
  the profile directory.
- A `session/set_model` call that times out is no longer retried blindly: the session is re-read,
  the switch is adopted when it landed, and the session is marked disconnected when Hermes cannot
  confirm it, so a blind retry can never move you to a model you did not pick.
- Approvals are visible from every tab, queued until the webview is ready, and a request that is
  denied without an answer (untrusted workspace, no options, 120s expiry) now says so in the view and
  the connection log instead of failing silently.

## 0.1.21

- Replace the README screenshot with the supplied real conversation image, independent of generated UI smoke-test screenshots.

## 0.1.20

- Default message and action text is 16px; tabs, wordmark and text-size controls remain 20% larger.
- Use Valve for readable navigation and controls; conversation titles are 18px, detail text 14px, and metadata 13px at the default scale.
- Verify typography proportions across text-size settings with the UI smoke test.

## 0.1.19

- The menu tabs, the logo (mark and HERMES wordmark) and the Text size label and value are now
  exactly 20% larger than prompt and response text (`--font-title` 1.15 → 1.20), alongside every
  heading. The tabs left the 1.7x action scale, so the tab bar drops from 22px to 15.6px at the
  default size and the header loses ~7px; Send / Stop / Context keep 1.7x.
- Removed the last literals that beat the header rule (welcome headline 29px, approval-card heading
  13px, stray `h1`/`h2` sizes), so the ratio now holds everywhere instead of only on panel headings.
- The UI smoke test asserts the 1.20x ratio for the tabs, logo and size control too, and no longer
  expects the tabs on the action scale.

## 0.1.18

- Re-release of 0.1.17 with no functional changes: rebuilt and version-stamped so the artifact
  matches the published tag.

## 0.1.17

- Header-level text — the HERMES wordmark, the logo mark, the session title and every panel heading —
  is now exactly 15% larger than message text (`--font-title`), instead of the previous 1.23–1.46×
  drift caused by per-element literals. The ratio follows `radcode.fontSize`, and the UI smoke test
  asserts it.

## 0.1.16

- Slimmer chrome: header 150 → 92 px, footer 250 → 119 px (23% of the view), by settling the action
  type scale at 1.7× the base size and collapsing stacked rows (wordmark and tagline share a line,
  session bar and status strip are one line each, two-row composer).
- Fixed the Subagents panel swallowing clicks: it scrolls as a plain block again instead of a flex
  column, where a trailing caption overlapped the preset form's last button.
- The approval-mode select no longer truncates to "Accept Edi"; the context-meter text ellipses first.

## 0.1.15

- `Compact` is back beside the context meter.
- `Stop` is always visible and disabled when there is nothing to cancel.
- Actions carry glyphs: `■ Stop`, `▶ Send`.

## 0.1.14

- Text-size slider moved above the tabs.
- No page-level scrollbar: the webview is a fixed shell and only the transcript and panels scroll.
- `Connect to Hermes` is a full-size primary button.
- Text-size writes survive a stale extension manifest (mirrored into extension state).

## 0.1.13

- Model selector fills with the accent colour and turns its label near-black on hover.
- `＋ Context` matches the other primary actions; the Show-reasoning checkbox is themed.
- Text-size slider added under the context meter and bound to `radcode.fontSize`.
- Type hierarchy rebalanced: wordmark, session title, section labels and message labels no longer
  sit at body size.

## 0.1.12

- `Compact` adopts the primary action size.

## 0.1.11

- Tabs, model button, Screenshot, Stop and Send are raised to three times the base size.

## 0.1.10

- Pasted-image thumbnails decode again (`img-src {{cspSource}} data:` in the webview CSP).
- 13px floor for all text, routed through one `--font-min` token.

## 0.1.9

- Bundled Pixelzone and Valve faces now actually apply: the `font:` shorthand no longer overrides the
  later `font-family` rule.
- Reasoning blocks render at their chronological position instead of the end of the transcript.
- Status spinner wired to the session state.

## 0.1.8

- Reasoning toggle keeps history order; timestamps on every entry.

## 0.1.7

- Effort ladders are fetched when a model loads, not on the first effort change.

## 0.1.6

- Per-model Mistral ladders via `route_efforts(provider, model, base_url)`, plus the bundled Mistral
  provider plugin.

## 0.1.4 – 0.1.5

- Code split into `src/extension/*` and `src/webview/*` with the domain logic free of VS Code imports.
- Fixes: oversized-image rejection, context meter reset after an effort change, model switching via
  `session/set_model`, compaction no longer wipes the transcript.

## 0.1.1 – 0.1.3

- Context-aware attachments (the open editor is offered as a chip), accent and font settings,
  inline approval cards with a details modal, MCP server configuration, session rename through
  `session.mutate`, actionable "Hermes is not installed" errors.

## 0.1.0

- First build: streaming chat over ACP, resumable sessions, model-aware thinking controls,
  configurable worker agents.
