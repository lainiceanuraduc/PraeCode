"""Per-route effort ladders for the selector. Mistral is a first-class route, not a fallback."""
from __future__ import annotations

from discovery import mistral, routes


class EffortCatalog:
    def resolve(self, provider, model, base_url=''):
        from providers import get_provider_profile
        from agent import reasoning_effort as levels
        provider = str(provider or '').strip().lower()
        model = str(model or '').strip()
        ladder = routes.route_efforts(provider, model, base_url)
        if ladder is not None:
            if not ladder:
                # A model that rejects every reasoning_effort value: offer nothing, not a dead control.
                note = mistral.note_for_model(model) if mistral.note_for_model and routes.mistral_native_route(provider, base_url) \
                    else routes.MISTRAL_UNVERIFIED_NOTE
                return {'values': [], 'note': note}
            if routes.mistral_native_route(provider, base_url):
                note = mistral.note_for_model(model) if mistral.note_for_model else routes.MISTRAL_NATIVE_NOTE
                profile = get_provider_profile('mistral')
                if profile is None or not routes.is_mistral_profile(profile):
                    # Stock Hermes sends no reasoning field to api.mistral.ai at all, so the level
                    # would be recorded but never transmitted. Say so instead of a dead toggle.
                    note += (" Hermes has no Mistral provider profile, so this level is stored but not sent; "
                             "install hermes-plugin/mistral to enable it on the wire.")
            elif routes.is_ollama_route(provider, base_url):
                note = routes.MISTRAL_CLOUD_NOTE if routes.is_mistral_model(model) else \
                    (routes.OLLAMA_LOCAL_NOTE if routes.is_ollama_local(provider, base_url) else routes.OLLAMA_CLOUD_NOTE)
            else:
                note = routes.MISTRAL_NATIVE_NOTE
            return {'values': [x for x in ladder if x in levels.EFFORT_LADDER], 'note': note}
        if routes.mistral_native_route(provider, base_url):
            # An unverified model must not inherit the generic profile's OpenAI-compatible set: on
            # api.mistral.ai a wrong level is a 400 on every turn, not a clamp.
            return {'values': [], 'note': routes.MISTRAL_UNVERIFIED_NOTE}
        if provider == 'openrouter' or routes.is_openrouter_host(base_url):
            # OpenRouter: ask its catalog rather than guessing, honouring the tri-state contract.
            caps = routes.openrouter_capabilities(model)
            if caps is not None and not caps.get('supports_reasoning'):
                return {'values': [], 'note': routes.OPENROUTER_OFF_NOTE}
            if caps is None:
                return {'values': [x for x in levels.OPENAI_COMPAT_WIRE_EFFORTS if x in levels.EFFORT_LADDER],
                        'note': routes.OPENROUTER_UNLISTED_NOTE}
            supported = caps.get('supported_efforts')
            if not supported:
                # Advertised as reasoning-capable with no per-level list: every level is accepted.
                values = list(levels.OPENAI_COMPAT_WIRE_EFFORTS)
            else:
                values = [str(v) for v in supported]
            if caps.get('mandatory'):
                values = [v for v in values if v != 'none']
            return {'values': [x for x in values if x in levels.EFFORT_LADDER and x != 'ultra'],
                    'note': routes.OPENROUTER_NOTE}
        if routes.is_openai_host(base_url):
            # A custom route pointed straight at api.openai.com: use OpenAI's own per-generation ladder.
            return {'values': [x for x in levels.codex_supported_efforts(model) if x in levels.EFFORT_LADDER],
                    'note': routes.OPENAI_DIRECT_NOTE}
        profile = get_provider_profile(provider)
        declared = profile.supported_reasoning_efforts(model) if profile else None
        note = 'Capabilities from installed Hermes provider policy.'
        values = declared
        if provider == 'openai-codex':
            values = levels.codex_supported_efforts(model)
        elif values is None and provider == 'anthropic' and 'claude' in model.lower():
            from agent.anthropic_adapter import (_supports_adaptive_thinking, _supports_xhigh_effort,
                                                 _accepts_thinking_disable, _is_pre_thinking_haiku)
            if _is_pre_thinking_haiku(model):
                values = ('none',)
            elif _supports_adaptive_thinking(model):
                values = tuple((['none'] if _accepts_thinking_disable(model) else []) +
                               ['low', 'medium', 'high'] + (['xhigh'] if _supports_xhigh_effort(model) else []) + ['max'])
            else:
                values = ('none', 'low', 'medium', 'high')
                note = 'Hermes maps these levels to legacy thinking token budgets.'
        if values is None:
            return {'values': [], 'note': 'Unknown effort capabilities for this provider/model. No speculative levels are offered.'}
        return {'values': [x for x in values if x in levels.EFFORT_LADDER and x != 'ultra'], 'note': note}
