# Research notes — Hermes features & GUI guidelines

Sources (fetched 2026-10-23):
`hermes-agent.nousresearch.com/docs/llms.txt`, `/docs/user-guide/features/acp`,
`/docs/user-guide/features/delegation`, the installed source tree (`acp_adapter/`, `providers/`,
`agent/reasoning_effort.py`, `gateway/session_mutation_policy.py`), and
`code.visualstudio.com/api/ux-guidelines/webviews` + `/api/extension-guides/webview`.

## 1. Hermes feature inventory (what the product actually ships)

Surfaces: CLI, Ink TUI, native Electron desktop, web dashboard, ACP server (VS Code/Zed/JetBrains),
OpenAI-compatible proxy, messaging gateway (Telegram, Discord, Slack, WhatsApp, Signal, Matrix,
Teams, Email, SMS, IRC, LINE, WeCom, Feishu, Google Chat + more).

Core agent: tools/toolsets, skills (progressive disclosure, hub, curator), memory (MEMORY.md/USER.md,
pluggable providers: Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover,
Supermemory), session store + search, context files (`AGENTS.md`, `.hermes.md`, `SOUL.md`), context
references (`@file`, diffs, URLs), personalities, plugins/hooks/middleware, MCP servers, webhooks.

Automation: `delegate_task` delegation (leaf/orchestrator, batch, background, cost rollup), cron,
persistent goals, loops/heartbeats, kanban multi-agent board, batch processing, code execution,
subagent lifecycle API, bot mode (profile roster, routines, group chats).

Media/web: browser control, vision, image generation, TTS/STT + voice mode/wake word, document
extraction, deliverable attachments, web search/extract/crawl, X search, Spotify.

Models & routing: 30+ providers, OAuth + API keys, credential pools, fallbacks, provider routing,
MoA presets, subscription proxy, local models (Ollama/llama.cpp), fast/service tiers, **reasoning
effort** with per-model overrides, profiles, managed scope, egress proxy, checkpoints/rollback.

Security: dangerous-command approval, safe mode, secret redaction, workspace/pii guards, container
isolation, credential vault.

## 2. ACP contract that matters for this extension

- Transport: newline-delimited JSON-RPC 2.0 over stdio; stdout is protocol-only.
- `initialize` → `session/new` → `session/prompt` → `session/update` notifications
  (`agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`,
  `available_commands_update`, `usage_update`), `session/request_permission` server→client.
- `session/set_model` exists; **`session/set_config_option` is accepted but Hermes currently applies
  nothing for arbitrary config ids** (`acp_adapter/server.py` stores unknown options). An ACP
  "effort" dropdown wired to `set_config_option` would therefore be decorative.
- The real, fenced control is the gateway's `reasoning` session mutation
  (`gateway/session_mutation_policy.py::prepare_reasoning`), which freezes the level for the session
  policy. PraeCode uses that through `bridge/control.py`, then reads `session.info.reasoning_effort`
  back. This is why the selector shows a confirmed value rather than an assumption.
- Model switching goes through Hermes' guarded mutation; ACP surfaces it as a permission request,
  which PraeCode renders as a modal approval.

## 3. Effort ladders (verified in the installed tree + live probes 2026-10-23)

Canonical Hermes ladder: `none, minimal, low, medium, high, xhigh, max, ultra` (ultra is Codex-harness
internal; RadCode never offers it). Real per-route subsets include:

- OpenAI/Codex: `none, low, medium, high, xhigh` (legacy) vs `…, max` (5.6/6-tier); Astra has **no
  disable**: `low..max`.
- xAI: `low..xhigh` (Grok 4.6+), `low..high` legacy.
- Anthropic adaptive Claude: `none` (only when disable is accepted), `low, medium, high`, `xhigh`
  (Opus 4.7+), `max`; legacy models map to budgets.
- Kimi K3: `low, high, max`; GLM-5.2: `high, max`; DeepSeek V4/Ollama Cloud: `low..max`;
  Gemini 4: `low, medium, high`; TokenHub/Nebius/Solar: `low, medium, high`.

### Mistral — one API, four ladders (per model)

Probed live 2026-10-23 against `api.mistral.ai`: one `max_tokens=1` request per (model, level), 30
model ids. Mistral has four behaviours, not one ladder:

| Group | Models | Accepted `reasoning_effort` |
|---|---|---|
| Two-level | `mistral-large-4`, `mistral-medium-*`, `mistral-small-*`, `magistral-*`, `mistral-vibe-cli-*` | `none`, `high` (others: HTTP 400 `supported values: [high, none]`) |
| Mandatory | `zai-glm-5`, `zai-glm-5-3`, `zai-glm-5-3-flash`, `zai-glm-latest` | `low`, `high`, `max` — no `none`, reasoning cannot be disabled |
| Full | `glm-5-2`, `zai-glm-5-2` | every level, including `minimal`/`xhigh`/`max` |
| No reasoning | `mistral-large-latest` (Large 3), `ministral-*`, `codestral-*`, `mistral-code-*`, `voxtral-small-*` | **none** — any value, even `none`, is HTTP 400 `reasoning_effort is not enabled for this model` |

On the Ollama route the same models follow Ollama's route-wide ladder instead
(`none, low, medium, high` for Mistral-served models; `xhigh`/`max` clamp down).

Two traps the table encodes explicitly, because a name-prefix rule gets both wrong:

- `mistral-large-latest` is **Large 3 with reasoning disabled**, while `mistral-large-4` is on the
  two-level ladder.
- The Z.ai GLM routes are served **by** Mistral: the id is not a Mistral model name but the request
  still goes to `api.mistral.ai`, so the *route* picks the ladder, never the model name.

The table lives in `hermes-plugin/mistral/mistral_ladders.py` and is read by both the selector
(`bridge/control.py`) and the wire (the provider profile). A model id that has never been verified
gets no levels and a note — on this API a wrong level is a 400 on every turn, not a clamp.

Wire caveat: stock Hermes registers no `mistral` provider profile, and
`_supports_reasoning_extra_body()` is deliberately false for `api.mistral.ai`, so no reasoning field
is sent at all on that route. RadCode says so in the selector note and bundles an optional profile
(`hermes-plugin/mistral/`) that emits a **top-level** `reasoning_effort`, declares the per-model
ladder, and omits the field entirely for the no-reasoning group — the earlier hard-coded `none/high`
version made every turn fail on Ministral, Codestral and Large 3. On Ollama
Cloud the stock path already works, gated by `/api/show` thinking capability.

Consequence for UI: **never hardcode one ladder**; resolve per provider+model+host and hide unsupported
levels. `none` must be presented as "None / Off", not a weaker effort.

## 4. GUI guidelines applied here

From VS Code's webview UX/security guidance:

- Webviews only where native UI cannot express the need; keep commands in the toolbar/menus.
- Themeable with `--vscode-*` tokens (light/dark verified in screenshots).
- Accessibility: ARIA roles for tabs/panels, `aria-selected`, arrow-key tab navigation, labels on
  every input, `role="log"` transcript, visible focus rings, no color-only status.
- CSP: `default-src 'none'`, nonce for script, `connect-src 'none'`, resource roots limited to
  `media/` and `dist/`.
- Never open on every window / on update; activation happens on the view or an explicit command.
- Workspace trust is respected; the extension declares itself unsupported in untrusted workspaces.
- Keep long-running work cancellable and never block the editor main thread (everything async).

Attachments are context-aware: the control under the composer mirrors the active editor and offers
it in one click, then falls back to a workspace file picker. The webview only ever names paths; the
host reads and validates them at send time, so a file is sent as it is now, never as it was when the
chat was typed.

Product-level choices: errors are actionable and visible (inline alert + toast), the composer clears
as soon as a message is submitted and a rejected admission restores the exact draft (never overwriting
new typing), destructive actions confirm, and the "Features" tab labels what v0.1 does not implement
instead of faking controls.

## 5. Gaps deliberately left for v0.2+

MCP/cron/kanban/profile admin, native `delegation.*` editing, skills & memory browsers, voice/vision,
session search, and multi-root/remote workspaces. The bridge is intentionally narrow (catalog +
inspect + fenced effort) rather than a generic gateway RPC surface.
