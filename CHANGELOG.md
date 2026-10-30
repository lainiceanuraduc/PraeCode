# Changelog

## 0.1.34

- **Three bundled faces, one per role, all CC0 1.0.** Titles use **Anklepants** (Ray Larabie),
  tabs and buttons use **Not Jam Mono Clean 13** (Not Jam), and prompts, responses, reasoning and
  tables use **Kubasta** (Kai Kubasta). Reasoning and tables are italic, which the browser synthesises
  because none of the three ships an italic cut. Public Pixel is gone.
- **Every licence was verified from the delivered file, not the host badge**, and five candidates were
  rejected on that evidence: BLACK CAPS (name table: "free for personal use, email for commercial"),
  Quicksilver Sea (FontStruct Commercial EULA — no redistribution, no webfont), Web Serveroff
  (CC BY-ND), fs hakumo (CC BY-SA), and nullptr (CC0 but ships only a `.xcf` and a bitmap atlas).
  Provenance for the three shipped faces is in `media/fonts/*.LICENSE.txt`.
- **The glyph gap is documented, not hidden.** These faces carry 126–902 glyphs, so the UI's
  geometric icons (`▶ ■ ⚙ ＋ ✎ ↶ ↗ ★`) and a few punctuation marks resolve through the monospace
  fallback declared after each family. The UI smoke test now asserts each family loads *and* that
  titles, tabs/buttons, prompt and response each resolve to their own face.

## 0.1.33

- **Mistral ladders are discovered from the API, not assumed.** `GET /v1/models` never publishes the
  per-model `reasoning_effort` list, but a rejected level names it in the 400 body — in two different
  shapes. One tiny request per model (`max_tokens: 1`) therefore learns the exact ladder, and the
  result is cached in `$HERMES_HOME/cache/praecode/mistral-ladders.json` for a week. **Both** the wire
  (the bundled provider profile) and the selector (`bridge/control.py`) read the cache first and the
  shipped table second, so they can no longer disagree. All 38 chat models discover in ~10 s.
- **The table was wrong for the flagship models.** `mistral-large-4` / `mistral-large-4-0` accept
  `low`/`medium`/`high` and reject `none` — the old `none,high` entry offered a level that 400s and hid
  two that work. `deepseek-v4-1-flash-1017` (absent) accepts `none/low/high/xhigh/max`. Both now match
  `docs.mistral.ai` and the live probe; `scripts/mistral-ladders-smoke.py` asserts the doc values.
- **The picker shows what the provider actually publishes.** Opening it on a Mistral session issues one
  request and renders, per row: context window, capability chips (reasoning / vision / FIM), the exact
  effort ladder, and a **verified** badge when the ladder came from a probe rather than the table.
  Embeddings, OCR, TTS and transcription models are filtered out by `capabilities.completion_chat`
  (26 rows that could never complete a chat used to be selectable). `lab` is filled from `owned_by`.
- **Labs models are blocked, not offered.** `labs-leanstral-*` answers 403 unless the organisation
  enables Labs, so those rows are dimmed, unselectable, and say why; the profile also omits the
  reasoning field for them instead of adding a second failure.
- New bridge actions `mistral_models` (one request, chat-capable rows with facts) and
  `mistral_discover` (probe one model, cache it). `npm run test:mistral` checks the docs, the refusal
  parser, and the cache/seed precedence.

## 0.1.32

- **Renaming no longer depends on the ACP connection.** A rename is a metadata edit in Hermes, not a
  conversation action, so a session that is disconnected — or that only exists in the saved index and
  was never loaded in this window — can still be renamed (`SessionController.renameSaved`). Only a
  running turn is refused now; the old "resume it first" refusal is gone.
- **A failed transcript replay after a successful compaction is a warning, not an error.** Hermes has
  already committed the summary when the replay runs, so re-attaching failing used to report the whole
  compaction as failed while the context really was compacted — inviting the user to compact again.
  "Nothing to compact" is now a result too, never an error.
- **The context window is shown before the first turn.** `session.info` never publishes a window and
  occupancy only arrives with `usage_update`, so the meter used to appear only after a prompt. The
  model catalog's window is now the denominator at load (`context.source: 'catalog'`), the meter reads
  "209k window" until Hermes reports occupancy, and an inspect that omits the window can no longer
  erase a known one.

## 0.1.31

- **The Subagents tab now shows delegation itself, not just presets.** Opening it asks Hermes for
  `delegate_task` state and renders: the policy that governs child runs (concurrent children, spawn
  depth, child timeout, orchestrator, one-shot limit, child model, backend), every child run that is
  live right now, and the recent finished runs with model, message/tool counts, duration and the
  conversation they were delegated from. Refresh re-reads it on demand.
- New bridge action `subagents`: reads the `delegation:` policy block (never `api_key`) and
  `source='subagent'` rows from Hermes' `state.db`, attributed to this workspace through their parent
  conversation. Nothing is inferred: a missing value reads as unknown.
- `scripts/delegation-smoke.ts` (`npm run test:subagents`) proves it against a live install.

## 0.1.30

- **Status bar: four equal cells.** Spinner+state, approval mode, context meter and Compact each take
  exactly a quarter of the row (`grid-auto-flow:column;grid-auto-columns:1fr`). Compact is no longer
  nested inside the meter, so hiding the meter can never hide it.
- A narrow quarter degrades instead of clipping mid-word: below 620px the meter shows its percentage
  alone (window and message count stay in the tooltip), the select shrinks and ellipsizes, and Compact
  ellipsizes rather than overflowing.

## 0.1.29

- **Menu tabs are exactly one third each**, with centred labels and the active underline spanning the
  whole third. Tab type sits at 1.5× the reading size (not 1.6×) so "Subagents" still fits a third of a
  430px sidebar; narrower columns ellipsize instead of scrolling or overlapping.

- **Composer actions are keycaps, not text.** Context, Screenshot, Stop and Send share one shape
  (square corners, 1px border, hard offset shadow plus an inset bottom edge, 2.1× font-height tall)
  and press in on `:active`. Send is the only filled accent action, Stop is a warning outline that
  dims when there is nothing to cancel, and the quiet pair lights up in the accent on hover. The two
  quiet actions wrap as a unit so Stop and Send always share the closing line, grouped on the right.
- Compact follows the same shape at utility size rather than a bare 1px box.

- **Type hierarchy inverted to what was asked for.** The size slider now runs **1–30** with a default of
  10. Prompts, responses, reasoning and code render at that size in regular weight; buttons,
  dropdowns, tabs, headings and the model picker are 1.4×/1.6× larger **and bold**, so prominence is
  weight and size while reading text stays quiet. Message markdown bold is rendered regular so a reply
  never looks like chrome.
- **Conversations survive updates and reinstalls.** The history index used to be rebuilt on every
  publish against a profile name that was still empty at startup, which could overwrite it with a
  filtered-down copy; and nothing was restored when the view opened. Startup now merges rather than
  replaces (per profile and id, no 30-row cap), lists every saved conversation in the picker, and
  resumes the last one.
- **Hermes is the source of truth for history.** New bridge action `sessions` reads the conversations
  this editor created from Hermes' own `state.db` (`source='local'`/`created_source='acp'`), so a wiped
  extension index is recoverable. ACP's `session/list` only sees the empty `source='acp'` probe shells,
  which is why the extension could not find them before.
- Resuming a conversation no longer throws its transcript away when the load fails.

## 0.1.26

- **Type sizes rebalanced for Public Pixel.** Its advance is a full em per character, so 10 px text was
  both illegible and wide. `--ui-text: max(13px, var(--ui-size))` floors every size in CSS, the slider
  and `radcode.fontSize` start at 13, and `clampTextSize` refuses anything lower.
- **Reading column capped at 1000 px.** Header, tabs, transcript, composer, permissions and panels are
  centred, so a 1920 px window no longer produces 1890 px message lines and 1000 px action cells.
- **Tabs and composer actions are content-sized.** Tabs no longer stretch 600 px apart; the action row
  wraps instead of clipping or splitting "Screenshot" mid-word.
- **Model picker:** 1080 px wide, details stacked label-over-value with a value column of at least
  200 px (was 93 px, which broke prose into one or two characters per line); the two model lists stack
  below 620 px; the empty Favorites list shows one message, not two.

## 0.1.25

- Use bundled Public Pixel for all webview text, including messages, code and profile editors.
  Preserve size, bold and italic hierarchy; retire font-family overrides.
- Allow narrow tabs to scroll and give composer actions two columns so pixel labels do not overlap.

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
