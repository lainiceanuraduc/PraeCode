"""Narrow, version-gated local bridge. Never emits config, tokens or credentials.

Run with Hermes' own runtime: hermes --run-module runpy /path/control.py.
Only catalog reads and fenced session reasoning changes are exposed, not arbitrary RPC.
"""
import asyncio
import contextlib
import json
import sys
from urllib.parse import urlsplit

# Mistral's API does NOT have one ladder: the accepted reasoning_effort values differ per model, and
# a whole family of models rejects the field outright (HTTP 400 "reasoning_effort is not enabled for
# this model", even for "none"). The table lives next to the bundled provider profile so the wire and
# the selector can never disagree; it is loaded by path because this bridge runs outside the plugin
# package when the extension ships both.
MISTRAL_NATIVE_EFFORTS = ('none', 'high')
try:
    import sys as _sys
    _plugin_dir = str(__import__('pathlib').Path(__file__).resolve().parent.parent
                      / 'hermes-plugin' / 'mistral')
    if _plugin_dir not in _sys.path:
        _sys.path.insert(0, _plugin_dir)
    from mistral_ladders import efforts_for_model as _mistral_efforts, note_for_model as _mistral_note
except Exception:  # pragma: no cover - the extension always ships the table; a bare copy may not
    _mistral_efforts = None
    _mistral_note = None

MISTRAL_NATIVE_NOTE = ("Mistral API ladder: none or high. Mistral rejects every other level "
                       "(minimal/low/medium/xhigh/max) with HTTP 400, so they are not offered.")
MISTRAL_UNVERIFIED_NOTE = ("This Mistral model has not been verified against the API, so no level is "
                           "offered rather than one that would fail at the provider.")
# Ollama Cloud's OpenAI-compatible endpoint accepts these for Mistral models (verified live:
# all 200, thinking engaged for low..high, none disables it). Ollama's top level is high, so
# xhigh/max clamp down rather than being offered as distinct tiers.
MISTRAL_CLOUD_EFFORTS = ('none', 'low', 'medium', 'high')
MISTRAL_CLOUD_NOTE = ("Ollama Cloud ladder for Mistral: none, low, medium, high. Ollama accepts these; "
                      "xhigh and max clamp down to high.")
_MISTRAL_PREFIXES = ('mistral-', 'mistral_', 'magistral', 'ministral', 'codestral', 'voxtral',
                     'pixtral', 'labs-leanstral', 'mistral')

# Ollama Cloud's stock Hermes profile pushes every model through one top-level ``reasoning_effort``
# field and declares no per-model vocabulary, so the catalog answered "unknown" and the selector
# stayed disabled. The ladder is Hermes' own; import it rather than duplicating the tuple here.
OLLAMA_CLOUD_NOTE = ('Ollama Cloud ladder (all hosted models): none, low, medium, high, max. '
                     'Hermes maps xhigh to max; thinking is on by default, so none is the off switch.')
# A local Ollama daemon takes `think` (boolean or a model-defined named level discovered through
# /api/show), and Hermes' custom profile clamps to the OpenAI-compat set, so the same levels work —
# but the daemon is the user's own machine, not the Cloud fleet.
OLLAMA_LOCAL_NOTE = ('Local Ollama: the ladder Hermes can send (`think` levels). Which levels a specific '
                     'model really uses is published by /api/show; Hermes clamps anything else.')
# OpenRouter normalises providers and publishes per-model reasoning metadata in /v1/models. Hermes
# reads that catalog (hermes_cli.models_reasoning_caps) and clamps at request time, so the extension
# asks the same catalog instead of guessing — the tri-state answer is definitive.
OPENROUTER_NOTE = ('OpenRouter ladder for this model, from its published reasoning metadata. '
                   'Hermes clamps to the same catalog at request time.')
OPENROUTER_UNLISTED_NOTE = ('OpenRouter has no reasoning metadata cached for this model yet. Offering the '
                            'OpenAI-compatible set: Hermes clamps per model on the wire, so an unsupported '
                            'level is reduced rather than rejected.')
OPENROUTER_OFF_NOTE = 'This OpenRouter model does not accept reasoning controls.'
# api.openai.com speaks the Responses/Chat reasoning ladder, not the OpenAI-compat ceiling: `minimal`
# is rejected (clamps to low) and `max` is reserved for the newest generations.
OPENAI_DIRECT_NOTE = ('OpenAI ladder for this model generation. Hermes maps minimal down and offers max '
                      'only where the model accepts it.')


def _host(base_url):
    try:
        return (urlsplit(str(base_url or '')).hostname or '').lower()
    except ValueError:
        return ''


def is_ollama_route(provider, base_url=''):
    host = _host(base_url)
    return 'ollama' in str(provider or '').lower() or host == 'ollama.com' or host.endswith('.ollama.com') \
        or host in {'localhost', '127.0.0.1'} and ':11434' in str(base_url or '')


def is_openrouter_host(base_url):
    host = _host(base_url)
    return host == 'openrouter.ai' or host.endswith('.openrouter.ai')


def is_mistral_model(model):
    bare = str(model or '').strip().lower().rsplit('/', 1)[-1]
    return any(bare.startswith(prefix) for prefix in _MISTRAL_PREFIXES)


def _openrouter_capabilities(model):
    """Per-model reasoning metadata from OpenRouter's own catalog, or None when unknown.

    ``{"supports_reasoning": True, "supported_efforts": [...] | None, "mandatory": bool}``.
    Cache-only by default in Hermes; the bridge passes ``allow_fetch`` because it is already a
    short-lived subprocess, not a per-request hot path.
    """
    try:
        from hermes_cli.models_reasoning_caps import openrouter_model_reasoning_capabilities
        return openrouter_model_reasoning_capabilities(model, timeout=8.0, allow_fetch=True)
    except Exception:
        # An unreachable catalog must degrade to "unknown", never to an exception or a guess.
        return None


def _is_openai_host(base_url):
    host = _host(base_url)
    return host == 'api.openai.com' or host.endswith('.openai.com')


def _is_ollama_local(provider, base_url):
    """A daemon on the user's machine, as opposed to the Cloud fleet."""
    return is_ollama_route(provider, base_url) and not _is_ollama_cloud(provider, base_url)


def _is_ollama_cloud(provider, base_url):
    """Cloud fleet, by host or by provider name — a session's baseUrl is often blank.

    ``public_info`` only fills ``baseUrl`` when the route or the session record carries one, so the
    provider name (``ollama-cloud`` / ``ollama_cloud``) is the reliable signal here.
    """
    host = _host(base_url)
    if host == 'ollama.com' or host.endswith('.ollama.com'):
        return True
    return 'cloud' in str(provider or '').lower()


def mistral_native_route(provider, base_url=''):
    """True when requests actually go to api.mistral.ai (any model, including the Z.ai ones)."""
    return str(provider or '').strip().lower() in {'mistral', 'mistralai'} \
        or _host(base_url) == 'api.mistral.ai'


def route_efforts(provider, model, base_url=''):
    """The exact ladder this route accepts, or ``None`` when the route is not decided here.

    Both callers go through this: the catalog shows it, and the effort mutation clamps stale values
    onto it. Keeping one function is what stops the selector and the wire from disagreeing — the
    GLM models on Mistral are the case that used to slip through a model-name check.
    """
    if mistral_native_route(provider, base_url):
        if _mistral_efforts is None:  # pragma: no cover - the table ships with the extension
            return MISTRAL_NATIVE_EFFORTS
        return _mistral_efforts(model)
    if is_ollama_route(provider, base_url):
        # Ollama Cloud has its own route-wide ladder; Mistral models there are capped at high.
        from agent.reasoning_effort import OLLAMA_CLOUD_EFFORTS
        return MISTRAL_CLOUD_EFFORTS if is_mistral_model(model) else OLLAMA_CLOUD_EFFORTS
    return None


def _is_mistral_profile(profile):
    """True only for the bundled plugin profile (declares our exact ladder), not a hypothetical one."""
    try:
        return tuple(profile.supported_reasoning_efforts('mistral-large-4') or ()) == MISTRAL_NATIVE_EFFORTS
    except Exception:
        return False



def clamp_mistral(effort, cloud=False):
    """Nearest-weaker clamp onto the Mistral ladder the route actually accepts."""
    from agent.reasoning_effort import clamp_effort
    return clamp_effort(effort, MISTRAL_CLOUD_EFFORTS if cloud else MISTRAL_NATIVE_EFFORTS)


def provider_is_mistral(public):
    """True when this session's request actually goes to a Mistral ladder (native or Ollama)."""
    provider = str(public.get('provider') or '').strip().lower()
    return (is_mistral_model(public.get('model')) and
            (provider in {'mistral', 'mistralai'} or is_ollama_route(provider, public.get('baseUrl'))) or
            _host(public.get('baseUrl')) == 'api.mistral.ai')



class EffortCatalog:
    """Per-route effort ladders. Mistral is a first-class route, not the generic fallback."""

    def resolve(self, provider, model, base_url=''):
        from providers import get_provider_profile
        from agent import reasoning_effort as levels
        provider = str(provider or '').strip().lower()
        model = str(model or '').strip()
        ladder = route_efforts(provider, model, base_url)
        if ladder is not None:
            if not ladder:
                # A model that rejects every reasoning_effort value: offer nothing, not a dead control.
                note = _mistral_note(model) if _mistral_note and mistral_native_route(provider, base_url) \
                    else MISTRAL_UNVERIFIED_NOTE
                return {'values': [], 'note': note}
            if mistral_native_route(provider, base_url):
                note = _mistral_note(model) if _mistral_note else MISTRAL_NATIVE_NOTE
                profile = get_provider_profile('mistral')
                if profile is None or not _is_mistral_profile(profile):
                    # Stock Hermes sends no reasoning field to api.mistral.ai at all, so the level
                    # would be recorded but never transmitted. Say so instead of a dead toggle.
                    note += (" Hermes has no Mistral provider profile, so this level is stored but not sent; "
                             "install hermes-plugin/mistral to enable it on the wire.")
            elif is_ollama_route(provider, base_url):
                note = MISTRAL_CLOUD_NOTE if is_mistral_model(model) else \
                    (OLLAMA_LOCAL_NOTE if _is_ollama_local(provider, base_url) else OLLAMA_CLOUD_NOTE)
            else:
                note = MISTRAL_NATIVE_NOTE
            return {'values': [x for x in ladder if x in levels.EFFORT_LADDER], 'note': note}
        if mistral_native_route(provider, base_url):
            # An unverified model must not inherit the generic profile's OpenAI-compatible set: on
            # api.mistral.ai a wrong level is a 400 on every turn, not a clamp.
            return {'values': [], 'note': MISTRAL_UNVERIFIED_NOTE}
        if provider == 'openrouter' or is_openrouter_host(base_url):
            # OpenRouter: ask its catalog rather than guessing, honouring the tri-state contract.
            caps = _openrouter_capabilities(model)
            if caps is not None and not caps.get('supports_reasoning'):
                return {'values': [], 'note': OPENROUTER_OFF_NOTE}
            if caps is None:
                return {'values': [x for x in levels.OPENAI_COMPAT_WIRE_EFFORTS if x in levels.EFFORT_LADDER],
                        'note': OPENROUTER_UNLISTED_NOTE}
            supported = caps.get('supported_efforts')
            if not supported:
                # Advertised as reasoning-capable with no per-level list: every level is accepted.
                values = list(levels.OPENAI_COMPAT_WIRE_EFFORTS)
            else:
                values = [str(v) for v in supported]
            if caps.get('mandatory'):
                values = [v for v in values if v != 'none']
            return {'values': [x for x in values if x in levels.EFFORT_LADDER and x != 'ultra'],
                    'note': OPENROUTER_NOTE}
        if _is_openai_host(base_url):
            # A custom route pointed straight at api.openai.com: use OpenAI's own per-generation ladder.
            return {'values': [x for x in levels.codex_supported_efforts(model) if x in levels.EFFORT_LADDER],
                    'note': OPENAI_DIRECT_NOTE}
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


def public_info(info, policy):
    provider = info.get('provider') or policy.get('provider') or ''
    base_url = info.get('base_url') or ''
    config = json.loads(policy.get('config_json') or '{}')
    route = config.get('model') or {}
    if isinstance(route, dict):
        if provider in ('', 'auto'):
            provider = route.get('provider') or provider
        base_url = base_url or route.get('base_url') or ''
    # Context telemetry: what the next turn will carry versus the model's window. Either side may be
    # absent on older Hermes builds; the UI shows "unknown" rather than inventing a number.
    used = info.get('context_tokens')
    limit = info.get('context_window') or info.get('context_limit')
    return {'model': info.get('model') or '', 'provider': provider, 'baseUrl': base_url,
            'effort': info.get('reasoning_effort') or '',
            'wireEffort': info.get('reasoning_effort_wire') or '',
            'approvalPolicy': info.get('edit_approval_policy') or 'default',
            'messages': int(info.get('message_count') or 0),
            'contextTokens': used if isinstance(used, int) else None,
            'contextWindow': limit if isinstance(limit, int) else None,
            'compactions': int(info.get('compaction_count') or 0)}


class HermesSessionControl:
    async def _rename(self, sid, title):
        """A metadata edit: ``session.mutate rename`` with the revision fence, no generation fence.

        ``/title`` is deliberately not used: ACP runs slash commands against a transient session
        that never reaches the session DB, so the new title would vanish on the next load.
        """
        import uuid
        if not isinstance(title, str) or not title.strip() or len(title) > 200:
            raise ValueError('A title between 1 and 200 characters is required')
        from hermes_cli.gateway_client import connect_gateway
        async with connect_gateway() as client:
            snapshot = await client.rpc('session.resume', session_id=sid)
            await client.rpc('session.mutate', session_id=sid, request_id=uuid.uuid4().hex,
                             expected_revision=snapshot['revision'], operation='rename',
                             payload={'title': title.strip()})
            # Read the exact target back; acceptance alone is not proof the title landed.
            info = await client.rpc('session.info', session_id=sid)
            stored = info.get('title')
            if stored != title.strip():
                # Another session may already hold this title; that refusal is Hermes' own text.
                raise RuntimeError('Hermes did not store this title; it may already be in use')
            return {'sessionId': sid, 'title': stored}

    async def _compact(self, sid, focus):
        """Manual compaction as a fenced ``session.mutate compress`` — the same mutation ``/compress``
        uses. Hermes owns the summary and the commit; this only reports the resulting size."""
        import uuid
        from hermes_cli.gateway_client import COMPRESS_RPC_TIMEOUT, connect_gateway
        payload = {'focus': str(focus)[:500]} if focus else {}
        async with connect_gateway() as client:
            snapshot = await client.rpc('session.resume', session_id=sid)
            result = await client.rpc('session.mutate', _timeout=COMPRESS_RPC_TIMEOUT, session_id=sid,
                                      request_id=uuid.uuid4().hex, expected_revision=snapshot['revision'],
                                      expected_generation=snapshot['execution_generation'],
                                      operation='compress', payload=payload)
            # A confirmation request is a refusal for an automated surface: nothing was written.
            if isinstance(result, dict) and result.get('status') == 'confirmation_required':
                raise RuntimeError('Hermes wants this compaction confirmed interactively; run /compress in the CLI')
            info = await client.rpc('session.info', session_id=sid)
            return {'sessionId': sid,
                    'compressed': bool(isinstance(result, dict) and result.get('status') not in ('nothing', 'nothing_to_compress')),
                    'messages': info.get('message_count'),
                    'summary': (result.get('summary') or result.get('output') or '')[:400] if isinstance(result, dict) else ''}

    async def execute(self, request):
        action = request.get('action')
        if action == 'catalog':
            return EffortCatalog().resolve(str(request.get('provider', '')), str(request.get('model', '')),
                                           str(request.get('baseUrl') or ''))
        if action not in ('inspect', 'effort', 'rename', 'compact'):
            raise ValueError('Unsupported bridge action')
        sid = request.get('sessionId')
        if not isinstance(sid, str) or not sid or len(sid) > 256:
            raise ValueError('A valid sessionId is required')
        if action == 'rename':
            return await self._rename(sid, request.get('title'))
        if action == 'compact':
            return await self._compact(sid, request.get('focus') or '')
        from hermes_cli.gateway_client import connect_gateway
        from hermes_cli.gateway_mutations import PreparedMutations
        async with connect_gateway() as client:
            snapshot = await client.rpc('session.resume', session_id=sid)
            subscription = snapshot.get('subscription_id')
            try:
                info = await client.rpc('session.info', session_id=sid)
                policy = (snapshot.get('receipt') or {}).get('policy') or {}
                public = public_info(info, policy)
                caps = EffortCatalog().resolve(public['provider'], public['model'], public['baseUrl'])
                if action == 'effort':
                    effort = request.get('value')
                    ladder = route_efforts(public['provider'], public['model'], public['baseUrl'])
                    if effort != 'default' and ladder:
                        # The UI only offers supported levels; clamp a stale or preset value onto this
                        # model's real ladder (GLM has no 'none', Ministral has no field at all) instead
                        # of letting the provider 400, then report what Hermes actually stored.
                        from agent.reasoning_effort import clamp_effort
                        effort = clamp_effort(effort, ladder)
                    if effort != 'default' and effort not in caps['values']:
                        raise ValueError('Unsupported effort for the active provider/model')
                    await PreparedMutations().apply(client, sid, 'reasoning', {'effort': None if effort == 'default' else effort})
                    # Read exact target back; never treat RPC acceptance alone as success.
                    info = await client.rpc('session.info', session_id=sid)
                    public = public_info(info, policy)
                    if effort != 'default' and public['effort'] != effort:
                        raise RuntimeError('Effort was not confirmed by the session; reconnect before retrying')
                return {**public, 'capabilities': caps}
            finally:
                if subscription:
                    with contextlib.suppress(Exception):
                        await client.rpc('session.detach', session_id=sid, subscription_id=subscription)


def main():
    try:
        request = json.loads(sys.stdin.readline(65537))
        # Hermes/provider discovery can print notices. Protocol stdout must stay JSON-only.
        with contextlib.redirect_stdout(sys.stderr):
            result = asyncio.run(HermesSessionControl().execute(request))
        print(json.dumps({'ok': True, 'result': result}))
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
