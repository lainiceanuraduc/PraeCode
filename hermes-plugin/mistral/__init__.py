"""Mistral provider profile for Hermes Agent — makes the effort ladder real, per model.

Why this exists: Hermes ships no ``mistral`` profile, so ``api.mistral.ai`` falls through the
generic path, where ``_supports_reasoning_extra_body`` is deliberately False and no reasoning
field is ever sent. Mistral's own API *does* accept a top-level ``reasoning_effort`` — but the
accepted values differ by model, and one family rejects the field outright (see
``mistral_ladders.py`` for the live-verified table).

The important consequence: for models with reasoning disabled (Ministral, Codestral, the code
models, Voxtral, and the ``mistral-large-latest`` alias) this profile must **omit** the field.
Sending even ``"none"`` returns ``reasoning_effort is not enabled for this model`` and the turn
fails, so a single hard-coded ladder was actively harmful for a third of the catalogue.

Install (optional — RadCode's selector works without it for Ollama Cloud routes):
    mkdir -p ~/.hermes/plugins/model-providers
    cp -r hermes-plugin/mistral ~/.hermes/plugins/model-providers/mistral

Remove the directory to return to Hermes' stock behaviour.
"""

from typing import Any, Optional, Tuple

from agent.reasoning_effort import clamp_effort, requested_effort
from providers import register_provider
from providers.base import ProviderProfile

try:  # package import when installed into ~/.hermes/plugins/model-providers/mistral
    from .mistral_ladders import efforts_for_model
except ImportError:  # loaded as a bare module by a test harness
    from mistral_ladders import efforts_for_model

#: Fallback for an id that has never been verified: the two-level ladder Mistral's own models use.
MISTRAL_EFFORTS: Tuple[str, ...] = ("none", "high")


class MistralProfile(ProviderProfile):
    """Per-model ``reasoning_effort``; never forces thinking on, never sends it where unsupported."""

    def supported_reasoning_efforts(self, model: Optional[str] = None) -> tuple[str, ...]:
        """Empty tuple = the model accepts no reasoning parameters at all (Hermes omits the field)."""
        efforts = efforts_for_model(model)
        return MISTRAL_EFFORTS if efforts is None else efforts

    def default_reasoning_config(self, model: Optional[str] = None) -> Optional[dict]:
        """No default config: an unset effort keeps Mistral's own default (omit the field)."""
        return None

    def build_api_kwargs_extras(
        self, *, reasoning_config: Optional[dict] = None, supports_reasoning: bool = False,
        model: Optional[str] = None, **context: Any,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        # The wire must match what this exact model accepts, not what the family used to accept.
        efforts = efforts_for_model(model)
        supported = MISTRAL_EFFORTS if efforts is None else efforts
        if not supported:
            # Reasoning disabled on this model: any reasoning_effort value is a 400.
            return {}, {}
        if not isinstance(reasoning_config, dict):
            return {}, {}
        if reasoning_config.get("enabled") is False:
            # A disable is only meaningful where "none" is a real level (never on the GLM routes).
            return ({}, {"reasoning_effort": "none"}) if "none" in supported else ({}, {})
        effort = requested_effort(reasoning_config)
        if effort is None:
            return {}, {}
        clamped = clamp_effort(effort, supported)
        # clamp_effort can land outside the set when the requested level is below the floor; a value
        # the model refuses is worse than no value at all.
        return ({}, {"reasoning_effort": clamped}) if clamped in supported else ({}, {})


register_provider(MistralProfile(
    name="mistral",
    display_name="Mistral AI",
    aliases=("mistralai",),
    env_vars=("MISTRAL_API_KEY", "MISTRAL_BASE_URL"),
    base_url="https://api.mistral.ai/v1",
    auth_type="api_key",
    supports_health_check=False,
))
