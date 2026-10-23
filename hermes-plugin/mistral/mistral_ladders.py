"""Per-model ``reasoning_effort`` ladders for the Mistral API.

Mistral does **not** have one ladder. Probed live on 2026-10-23 against ``api.mistral.ai`` (one
``max_tokens=1`` request per model and level, 30 model ids) it has four behaviours:

* ``('none', 'high')`` — Mistral's own reasoning models (Large 4, Medium 3.x, Small 4, Magistral,
  the Vibe CLI models). Every other level is refused with
  ``reasoning_effort <x> is not supported for this model, supported values: [high, none]``.
* ``('low', 'high', 'max')`` — the third-party Z.ai GLM 5 / 5.3 routes Mistral serves. There is **no
  ``none``**: reasoning cannot be switched off (``'none' is not supported ... ['low','high','max']``).
* ``('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')`` — GLM 5.2, which accepts every
  level including the two extra Hermes tiers.
* ``()`` — models with reasoning disabled: Ministral 3, Codestral, the code/FIM models, Voxtral, and
  — importantly — **``mistral-large-latest``**, the Large 3 alias. Sending *any* value, including
  ``none``, returns ``reasoning_effort is not enabled for this model``. For these the field must be
  omitted entirely.

Keeping this table beside the provider profile means the profile can omit the field for those models
instead of breaking every turn with a 400.

Used by both sides, so the truth lives in one place:
  * ``hermes-plugin/mistral/__init__.py`` — what goes on the wire.
  * ``bridge/control.py`` — what the extension's effort selector offers.
"""

from __future__ import annotations

from typing import Optional, Tuple

#: Hermes' tiers that Mistral's two-level ladder collapses onto.
NONE_HIGH: Tuple[str, ...] = ("none", "high")
#: Z.ai GLM 5 / 5.3 on Mistral: reasoning is mandatory, so there is no "off".
GLM_MANDATORY: Tuple[str, ...] = ("low", "high", "max")
#: GLM 5.2 accepts the full OpenAI-compatible set.
GLM_FULL: Tuple[str, ...] = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
#: No reasoning field may be sent at all.
NO_REASONING: Tuple[str, ...] = ()

#: Exact ids first: aliases are where a prefix rule would guess wrong
#: (``mistral-large-latest`` is Large 3 with reasoning off, ``mistral-large-4`` is on).
_EXPLICIT: dict[str, Tuple[str, ...]] = {
    # --- two-level Mistral reasoning models (probed) ---
    "mistral-large-4": NONE_HIGH,
    "mistral-large-4-0": NONE_HIGH,
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
    # Labs-gated (HTTP 403 without org access) but reasoning-capable in the catalogue.
    "labs-leanstral-1-5": NONE_HIGH,
    "labs-leanstral-1-5-1": NONE_HIGH,
    # --- Z.ai GLM served by Mistral ---
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
_NONE_HIGH_PREFIXES = (
    "mistral-large-4", "mistral-medium", "mistral-small", "magistral",
    "mistral-vibe-cli", "labs-leanstral",
)


def normalize(model: Optional[str]) -> str:
    """Bare id: strip a ``vendor/`` prefix (``mistralai/mistral-large-4``) and lowercase it."""
    return str(model or "").strip().lower().rsplit("/", 1)[-1]


def efforts_for_model(model: Optional[str]) -> Optional[Tuple[str, ...]]:
    """The levels this model accepts, or ``None`` when it has never been verified.

    ``None`` is deliberately distinct from ``()``: the caller must not treat "unknown" as
    "no reasoning", or a future model loses a control it really supports.
    """
    bare = normalize(model)
    if not bare:
        return None
    if bare in _EXPLICIT:
        return _EXPLICIT[bare]
    # Aliases that must be resolved before any prefix rule.
    if bare.startswith("mistral-large-latest") or bare.startswith("mistral-large-2512"):
        return NO_REASONING
    if bare.startswith(("glm-5-2", "zai-glm-5-2")):
        return GLM_FULL
    if bare.startswith(("glm-", "zai-glm")):
        return GLM_MANDATORY
    if bare.startswith(_NO_REASONING_PREFIXES):
        return NO_REASONING
    if bare.startswith(_NONE_HIGH_PREFIXES):
        return NONE_HIGH
    return None


def note_for_model(model: Optional[str]) -> str:
    """One line the UI can show next to the selector, per behaviour group."""
    efforts = efforts_for_model(model)
    if efforts == NO_REASONING:
        return ("This Mistral model has no reasoning controls; the API rejects any reasoning_effort "
                "value, so no level is offered.")
    if efforts == GLM_MANDATORY:
        return ("Z.ai GLM on Mistral: low, high or max. Reasoning cannot be switched off on this "
                "route, so 'none' is not offered.")
    if efforts == GLM_FULL:
        return "GLM 5.2 on Mistral accepts every level, including the two extended Hermes tiers."
    if efforts == NONE_HIGH:
        return ("Mistral's own ladder for this model: none or high. Every other level returns HTTP 400, "
                "so they are not offered.")
    return ("This Mistral model has not been verified, so no level is offered rather than a "
            "speculative one that would fail at the provider.")
