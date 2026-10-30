"""Per-model ``reasoning_effort`` ladders for the Mistral API — discovered, not assumed.

Mistral does **not** have one ladder, and it does not publish the per-model one. Three sources agree
on what matters:

* **The docs** (``docs.mistral.ai/studio/conversations/reasoning``): Mistral Large 4 accepts
  ``low``/``medium``/``high`` and explicitly *not* ``none``/``minimal``/``xhigh``/``max``; Small 4 and
  Medium 3.5 take ``none``/``high``; ``zai-glm-5-3`` takes ``low``/``high``/``max`` with no ``none``.
* **The API itself**, which names the accepted list in the 400 it returns for a level the model does
  not support. ``parse_refusal`` turns that into a ladder, so a new model needs no code change.
* **``GET /v1/models``**, which publishes ``capabilities.reasoning`` (may the field be sent at all),
  ``max_context_length``, ``owned_by`` and ``aliases`` — but never the levels.

The static table is therefore only the **offline seed**: the wire (this provider profile) and the
selector (``bridge/control.py``) both read the discovered cache first, so they cannot disagree.

Cache: ``$HERMES_HOME/cache/praecode/mistral-ladders.json``, written by the bridge, read by both.
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Optional, Tuple

#: Hermes' tiers, in ascending order — the order the API lists them in.
ORDER: Tuple[str, ...] = ("none", "minimal", "low", "medium", "high", "xhigh", "max")

#: Mistral's own two-level ladder (Small 4, Medium 3.5, Magistral, the Vibe CLI models).
NONE_HIGH: Tuple[str, ...] = ("none", "high")
#: Mistral Large 4 and its alias: three levels, and **no** ``none``.
LOW_MEDIUM_HIGH: Tuple[str, ...] = ("low", "medium", "high")
#: Z.ai GLM 5 / 5.3 on Mistral: reasoning is mandatory, so there is no "off".
GLM_MANDATORY: Tuple[str, ...] = ("low", "high", "max")
#: GLM 5.2 accepts the full OpenAI-compatible set.
GLM_FULL: Tuple[str, ...] = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
#: DeepSeek V4.1 Flash on Mistral: five levels, no ``minimal``/``medium``.
DEEPSEEK_FULL: Tuple[str, ...] = ("none", "low", "high", "xhigh", "max")
#: No reasoning field may be sent at all.
NO_REASONING: Tuple[str, ...] = ()

#: Cache schema: bump when the file's shape changes, so a stale file is ignored rather than trusted.
CACHE_VERSION = 1
#: A discovered ladder is good for a week; models ship faster than that, and a probe is one request.
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60

#: Exact ids first: aliases are where a prefix rule guesses wrong
#: (``mistral-large-latest`` is Large 3 with reasoning off, ``mistral-large-4`` is on).
_EXPLICIT: dict[str, Tuple[str, ...]] = {
    # --- Mistral Large 4 (docs + probe: low/medium/high, never none) ---
    "mistral-large-4": LOW_MEDIUM_HIGH,
    "mistral-large-4-0": LOW_MEDIUM_HIGH,
    # --- two-level Mistral reasoning models ---
    "mistral-medium": NONE_HIGH,
    "mistral-medium-latest": NONE_HIGH,
    "mistral-medium-3": NONE_HIGH,
    "mistral-medium-3-5": NONE_HIGH,
    "mistral-medium-3.5": NONE_HIGH,
    "mistral-medium-2604": NONE_HIGH,
    "mistral-small-latest": NONE_HIGH,
    "mistral-small-2603": NONE_HIGH,
    "magistral-medium-latest": NONE_HIGH,
    "magistral-small-latest": NONE_HIGH,
    "mistral-vibe-cli-latest": NONE_HIGH,
    "mistral-vibe-cli-fast": NONE_HIGH,
    "mistral-vibe-cli-with-tools": NONE_HIGH,
    # --- third-party models Mistral hosts ---
    "deepseek-v4-1-flash-1017": DEEPSEEK_FULL,
    "glm-5-2": GLM_FULL,
    "zai-glm-5-2": GLM_FULL,
    "zai-glm-5": GLM_MANDATORY,
    "zai-glm-5-3": GLM_MANDATORY,
    "zai-glm-5-3-flash": GLM_MANDATORY,
    "zai-glm-latest": GLM_MANDATORY,
    # --- reasoning disabled (any reasoning_effort value is a 400) ---
    "mistral-large-latest": NO_REASONING,   # Large 3, not Large 4
    "mistral-large-2512": NO_REASONING,
    "codestral-latest": NO_REASONING,
    "codestral-2508": NO_REASONING,
    "mistral-code-latest": NO_REASONING,
    "mistral-code-fim-latest": NO_REASONING,
    "voxtral-small-latest": NO_REASONING,
    "voxtral-small-2507": NO_REASONING,
    "ministral-14b-latest": NO_REASONING,
    "ministral-14b-2512": NO_REASONING,
    "ministral-8b-latest": NO_REASONING,
    "ministral-8b-2512": NO_REASONING,
    "ministral-3b-latest": NO_REASONING,
    "ministral-3b-2512": NO_REASONING,
}

#: Prefix families, so a new dated snapshot inherits its family's behaviour instead of guessing.
_NO_REASONING_PREFIXES = (
    "ministral", "codestral", "mistral-code", "voxtral", "mistral-embed",
    "ocr", "mistral-ocr", "voxtral-mini", "voxtral-small",
)
_NONE_HIGH_PREFIXES = ("mistral-medium", "mistral-small", "magistral", "mistral-vibe-cli")
_LOW_MEDIUM_HIGH_PREFIXES = ("mistral-large-4",)
_GLM_FULL_PREFIXES = ("glm-5-2", "zai-glm-5-2")
_GLM_PREFIXES = ("glm-", "zai-glm")
_DEEPSEEK_PREFIXES = ("deepseek-",)
#: Labs models need an organisation opt-in; without it every request is a 403, so no level is offered.
_LABS_PREFIXES = ("labs-",)

#: Tried in order until one is refused. ``xhigh`` is refused by every Mistral-native model; the rest
#: cover a model that happens to accept it (GLM 5.2) or accepts the whole enum.
PROBE_CANDIDATES: Tuple[str, ...] = ("xhigh", "none", "minimal", "medium", "low", "max")


def normalize(model: Optional[str]) -> str:
    """Bare id: strip a ``vendor/`` prefix (``mistralai/mistral-large-4``) and lowercase it."""
    return str(model or "").strip().lower().rsplit("/", 1)[-1]


def is_labs_model(model: Optional[str]) -> bool:
    """Labs models are gated per organisation; a level offered for one is a guaranteed 403."""
    return normalize(model).startswith(_LABS_PREFIXES)


def static_ladder(model: Optional[str]) -> Optional[Tuple[str, ...]]:
    """The shipped seed for this model, or ``None`` when it has never been verified.

    ``None`` is deliberately distinct from ``()``: the caller must not treat "unknown" as
    "no reasoning", or a future model loses a control it really supports.
    """
    bare = normalize(model)
    if not bare:
        return None
    if bare in _EXPLICIT:
        return _EXPLICIT[bare]
    # Aliases that must be resolved before any prefix rule.
    if bare.startswith(("mistral-large-latest", "mistral-large-2512")):
        return NO_REASONING
    if bare.startswith(_GLM_FULL_PREFIXES):
        return GLM_FULL
    if bare.startswith(_GLM_PREFIXES):
        return GLM_MANDATORY
    if bare.startswith(_DEEPSEEK_PREFIXES):
        return DEEPSEEK_FULL
    if bare.startswith(_NO_REASONING_PREFIXES):
        return NO_REASONING
    if bare.startswith(_LOW_MEDIUM_HIGH_PREFIXES):
        return LOW_MEDIUM_HIGH
    if bare.startswith(_NONE_HIGH_PREFIXES):
        return NONE_HIGH
    return None


# --------------------------------------------------------------------------- discovery


def parse_refusal(detail: str) -> Optional[Tuple[str, ...]]:
    """The accepted levels named in a 400 body, ordered; ``()`` when reasoning is off.

    Two shapes exist, and only the *list* may be parsed — the message also names the rejected value
    ("reasoning_effort='xhigh' is not supported"), so reading the whole string makes every model look
    like it accepts ``xhigh``::

        reasoning_effort none is not supported for this model, supported values: [<ReasoningEffort.high: 'high'>, ...]
        reasoning_effort='xhigh' is not supported for this model. Must be one of (<ReasoningEffort.none: 'none'>, ...)
    """
    text = str(detail or "")
    if "not enabled for this model" in text:
        return NO_REASONING
    match = re.search(r"(?:supported values:|Must be one of)\s*[\[(]([^\])]*)[\])]", text)
    if not match:
        return None
    found = set(re.findall(r"['\"]([a-z]+)['\"]", match.group(1)))
    levels = tuple(level for level in ORDER if level in found)
    return levels or None


# --------------------------------------------------------------------------- cache


def cache_path(hermes_home: Optional[str] = None) -> Path:
    home = Path(hermes_home or os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))
    return home / "cache" / "praecode" / "mistral-ladders.json"


def load_cache(hermes_home: Optional[str] = None) -> dict:
    """``{model: {"levels": [...] | None, "note": str, "checkedAt": epoch}}``; empty when unusable."""
    try:
        payload = json.loads(cache_path(hermes_home).read_text())
    except (OSError, ValueError):
        return {}
    if not isinstance(payload, dict) or payload.get("version") != CACHE_VERSION:
        return {}
    entries = payload.get("models")
    return entries if isinstance(entries, dict) else {}


def save_cache_entry(model: str, levels: Optional[Tuple[str, ...]], note: str = "",
                     hermes_home: Optional[str] = None) -> None:
    """Merge one discovery into the cache atomically, so a reader never sees half a file."""
    path = cache_path(hermes_home)
    entries = load_cache(hermes_home)
    entries[normalize(model)] = {"levels": list(levels) if levels is not None else None,
                                 "note": str(note or "")[:200], "checkedAt": time.time()}
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": CACHE_VERSION, "models": entries}, indent=1, sort_keys=True))
        os.replace(tmp, path)
    except OSError:
        pass                                        # a read-only profile must not break a turn


def discovered_ladder(model: Optional[str], hermes_home: Optional[str] = None,
                      ttl: int = CACHE_TTL_SECONDS) -> Optional[Tuple[str, ...]]:
    """A fresh discovered ladder for this model, or ``None`` (missing, stale, or unreadable)."""
    entry = load_cache(hermes_home).get(normalize(model))
    if not isinstance(entry, dict):
        return None
    checked = entry.get("checkedAt")
    if not isinstance(checked, (int, float)) or time.time() - checked > ttl:
        return None
    levels = entry.get("levels")
    if not isinstance(levels, list):
        return None
    return tuple(level for level in ORDER if level in levels)


def efforts_for_model(model: Optional[str], hermes_home: Optional[str] = None) -> Optional[Tuple[str, ...]]:
    """What this model accepts: the discovered ladder first, the shipped seed second.

    Both the wire and the selector call this, which is what keeps them in agreement.
    """
    discovered = discovered_ladder(model, hermes_home)
    if discovered is not None:
        return discovered
    return static_ladder(model)


def note_for_model(model: Optional[str], hermes_home: Optional[str] = None) -> str:
    """One line the UI can show next to the selector, per behaviour group."""
    if is_labs_model(model):
        return ("This is a Labs model: your organisation has not enabled it, so every request returns "
                "403 and no level is offered.")
    discovered = discovered_ladder(model, hermes_home)
    source = "read from the API" if discovered is not None else "from the shipped table"
    efforts = discovered if discovered is not None else static_ladder(model)
    if efforts == NO_REASONING:
        return ("This Mistral model has no reasoning controls; the API rejects any reasoning_effort "
                f"value, so no level is offered ({source}).")
    if efforts == LOW_MEDIUM_HIGH:
        return ("Mistral Large 4 accepts low, medium or high — not none, minimal, xhigh or max. "
                f"High is Mistral's recommended default ({source}).")
    if efforts == GLM_MANDATORY:
        return ("Z.ai GLM on Mistral: low, high or max. Reasoning cannot be switched off on this "
                f"route, so 'none' is not offered ({source}).")
    if efforts == GLM_FULL:
        return f"GLM 5.2 on Mistral accepts every level, including the two extended Hermes tiers ({source})."
    if efforts == DEEPSEEK_FULL:
        return ("DeepSeek on Mistral accepts none, low, high, xhigh or max — not minimal or medium "
                f"({source}).")
    if efforts == NONE_HIGH:
        return ("Mistral's own ladder for this model: none or high. Every other level returns HTTP 400, "
                f"so they are not offered ({source}).")
    return ("This Mistral model has not been verified, so no level is offered rather than a "
            "speculative one that would fail at the provider.")
