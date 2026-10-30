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
    from mistral_ladders import (efforts_for_model as _mistral_efforts, note_for_model as _mistral_note,
                                 is_labs_model as _mistral_labs, parse_refusal as _mistral_parse,
                                 save_cache_entry as _mistral_save, static_ladder as _mistral_static,
                                 discovered_ladder as _mistral_discovered,
                                 PROBE_CANDIDATES as _mistral_probe_levels)
except Exception:  # pragma: no cover - the extension always ships the table; a bare copy may not
    _mistral_efforts = None
    _mistral_note = None
    _mistral_labs = None
    _mistral_parse = None
    _mistral_save = None
    _mistral_static = None
    _mistral_discovered = None
    _mistral_probe_levels = ()

MISTRAL_NATIVE_NOTE = ("Mistral API ladder: none or high. Mistral rejects every other level "
                       "(minimal/low/medium/xhigh/max) with HTTP 400, so they are not offered.")


# --------------------------------------------------------------------------- Mistral discovery
#
# The per-model ladder is not published by `GET /v1/models`, but a rejected `reasoning_effort` names
# the accepted list. One tiny request per model therefore discovers it, and the result is cached for
# both the wire (the bundled provider profile) and this bridge's selector. The static table stays as
# the offline seed only.

def _mistral_key():
    """The API key for this profile, from the environment or Hermes' own .env. Never logged."""
    import os
    key = str(os.environ.get('MISTRAL_API_KEY') or '').strip()
    if key:
        return key
    home = os.environ.get('HERMES_HOME') or os.path.join(os.path.expanduser('~'), '.hermes')
    try:
        with open(os.path.join(home, '.env'), encoding='utf-8') as handle:
            for line in handle:
                if line.startswith('MISTRAL_API_KEY='):
                    return line.split('=', 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ''


def _mistral_post(path, key, payload, timeout=60):
    """One HTTPS POST to api.mistral.ai; returns (status, body text). No third-party dependency."""
    import urllib.error
    import urllib.request
    request = urllib.request.Request('https://api.mistral.ai/v1' + path, data=json.dumps(payload).encode(),
                                     headers={'Authorization': f'Bearer {key}',
                                              'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode('utf-8', 'replace')
    except Exception as exc:                       # network, DNS, timeout: unknown, never a guess
        return 0, str(exc)


def discover_mistral_ladder(model, key=''):
    """`(levels, note)` for one model, probing the API; `(None, note)` when it cannot be known."""
    if _mistral_labs is not None and _mistral_labs(model):
        return None, 'labs_gated'
    key = key or _mistral_key()
    if not key:
        return None, 'no_api_key'
    for level in _mistral_probe_levels or ('xhigh', 'none', 'minimal', 'medium', 'low', 'max'):
        status, body = _mistral_post('/chat/completions', key,
                                     {'model': model, 'max_tokens': 1, 'reasoning_effort': level,
                                      'messages': [{'role': 'user', 'content': 'hi'}]})
        if status == 200:
            continue                               # this model accepts `level`: try the next candidate
        if status == 403:
            return None, 'labs_gated'
        if status == 400:
            levels = _mistral_parse(body) if _mistral_parse else None
            if levels is not None:
                return levels, ''
        return None, f'http_{status}'
    # Every candidate was accepted, so the model takes the whole enum.
    return ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'), ''


def _mistral_models(key=''):
    """`GET /v1/models` as `{id: entry}`; empty when unavailable. One request, no per-model probing."""
    import urllib.request
    key = key or _mistral_key()
    if not key:
        return {}
    request = urllib.request.Request('https://api.mistral.ai/v1/models',
                                     headers={'Authorization': f'Bearer {key}'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode('utf-8', 'replace'))
    except Exception:
        return {}
    rows = payload.get('data') if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return {}
    return {str(row.get('id')): row for row in rows if isinstance(row, dict) and row.get('id')}


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
        if _mistral_labs is not None and _mistral_labs(model):
            return ()                              # gated per organisation: every request is a 403
        return _mistral_efforts(model)
    if is_ollama_route(provider, base_url):
        # Ollama Cloud has its own route-wide ladder; Mistral models there are capped at high.
        from agent.reasoning_effort import OLLAMA_CLOUD_EFFORTS
        return MISTRAL_CLOUD_EFFORTS if is_mistral_model(model) else OLLAMA_CLOUD_EFFORTS
    return None


def _is_mistral_profile(profile):
    """True only for the bundled plugin profile (declares our exact ladder), not a hypothetical one.

    The comparison must use the *current* seed for a known model, not a hard-coded tuple: when the
    table moved ``mistral-large-4`` from ``none/high`` to ``low/medium/high``, a literal here made
    every check fail and the UI claimed no Mistral profile was installed while it was.
    """
    try:
        expected = (_mistral_static('mistral-large-4') if _mistral_static is not None
                    else MISTRAL_NATIVE_EFFORTS)
        return tuple(profile.supported_reasoning_efforts('mistral-large-4') or ()) == tuple(expected or ())
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


def _positive_int(entry, *names):
    for name in names:
        value = entry.get(name) if isinstance(entry, dict) else None
        if isinstance(value, int) and value > 0:
            return value
    return None


def summarize_model(provider, model, base_url='', endpoint_entry=None, catalog_entry=None,
                    capabilities=None, provider_label=''):
    """Detail pane for one picker row, from already-fetched sources (no I/O here, so it is testable).

    Context is reported only when a source actually published it: provider ``/models`` first, then
    the shared model catalog. ``contextSource`` lets the UI say where the number came from instead
    of presenting a fallback default as fact. ``lab`` is the publishing lab (``owned_by``).
    """
    entry = endpoint_entry if isinstance(endpoint_entry, dict) else {}
    catalog = catalog_entry if isinstance(catalog_entry, dict) else {}
    from_endpoint = _positive_int(entry, 'max_context_length', 'context_length', 'max_input_tokens',
                                  'context_window')
    context = from_endpoint or _positive_int(catalog, 'context_length', 'max_input_tokens')
    return {'provider': str(provider or '')[:200], 'providerLabel': str(provider_label or '')[:120],
            'model': str(model or '')[:300], 'baseUrl': str(base_url or '')[:500],
            'lab': str(entry.get('owned_by') or catalog.get('provider') or '').strip()[:120],
            'capabilitiesHint': {key: bool((entry.get('capabilities') or {}).get(key)) for key in
                                 ('reasoning', 'vision', 'function_calling', 'completion_fim')}
                                if isinstance(entry.get('capabilities'), dict) else None,
            'context': context,
            'contextSource': 'provider' if from_endpoint else ('catalog' if context else ''),
            'catalogName': str(catalog.get('name') or '')[:200],
            'capabilities': capabilities or {'values': [], 'note': 'Unknown effort capabilities for this provider/model.'}}


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

    async def _model_info(self, provider, model, base_url):
        """Provider/model facts for the picker: lab, context window and the exact effort ladder."""
        if not model or len(model) > 300 or len(provider) > 200:
            raise ValueError('A provider and model are required')
        runtime = {}
        try:
            from hermes_cli.runtime_provider import resolve_runtime_provider
            runtime = await asyncio.to_thread(resolve_runtime_provider,
                                               requested=provider or None, target_model=model) or {}
        except Exception:
            runtime = {}
        resolved = base_url or str(runtime.get('base_url') or '')
        api_key = str(runtime.get('api_key') or '')
        endpoint_entry = None
        if resolved:
            try:
                from agent.model_metadata import fetch_endpoint_model_metadata
                fetched = await asyncio.to_thread(fetch_endpoint_model_metadata, resolved, api_key)
                endpoint_entry = (fetched or {}).get(model)
            except Exception:
                endpoint_entry = None
        catalog_entry = None
        try:
            from agent.model_metadata import fetch_model_metadata
            catalog = await asyncio.to_thread(fetch_model_metadata)
            catalog_entry = catalog.get(model) or catalog.get(model.rsplit('/', 1)[-1])
        except Exception:
            catalog_entry = None
        # `/v1/models` publishes `owned_by` and the real context length; the shared catalog often has
        # neither, which is why every Mistral row used to show an empty lab.
        if mistral_native_route(provider, resolved) and model:
            listed = await asyncio.to_thread(_mistral_models)
            entry = listed.get(model) if isinstance(listed, dict) else None
            if isinstance(entry, dict):
                endpoint_entry = {**(endpoint_entry or {}), **entry}
        label = ''
        try:
            from hermes_cli.providers import get_label
            label = str(get_label(provider) or '')
        except Exception:
            label = ''
        caps = EffortCatalog().resolve(provider, model, resolved)
        return summarize_model(provider, model, resolved, endpoint_entry, catalog_entry, caps, label)

    def _provider_save(self, request):
        """Add or update one provider in Hermes' own `providers:` block.

        Written through `hermes_cli.config.save_config` (not by editing YAML here), so the file keeps
        its schema handling, comments and unknown-key notices. The API key goes to the profile's
        `.env` under `<ID>_API_KEY` and the config stores only that variable's name — a key never
        lands in `config.yaml`, which is the file people paste into issues.
        """
        import os
        import re
        from pathlib import Path
        provider_id = str(request.get('id') or '').strip().lower()
        if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,39}', provider_id or ''):
            raise ValueError('Provider id must be lowercase letters, digits, dots or hyphens (max 40)')
        base_url = str(request.get('baseUrl') or '').strip().rstrip('/')
        if not re.match(r'^https?://', base_url):
            raise ValueError('Base URL must start with http:// or https://')
        label = str(request.get('label') or provider_id).strip()[:60]
        default_model = str(request.get('defaultModel') or '').strip()[:200]
        api_key = str(request.get('apiKey') or '').strip()

        home = Path(os.environ.get('HERMES_HOME') or (Path.home() / '.hermes'))
        key_env = ''
        if api_key:
            key_env = f"{provider_id.upper().replace('-', '_').replace('.', '_')}_API_KEY"
            env_path = home / '.env'
            lines = []
            if env_path.exists():
                lines = [line for line in env_path.read_text().splitlines()
                         if not line.startswith(f'{key_env}=')]
            lines.append(f'{key_env}={api_key}')
            env_path.write_text('\n'.join(lines) + '\n')
            with contextlib.suppress(OSError):
                os.chmod(env_path, 0o600)

        from hermes_cli.config import load_config, save_config
        config = load_config()
        providers = config.get('providers')
        if not isinstance(providers, dict):
            providers = {}
        entry = {'api': base_url, 'base_url': base_url, 'name': label, 'discover_models': True}
        if default_model:
            entry['default_model'] = default_model
            entry['model'] = default_model
        if key_env:
            entry['key_env'] = key_env
        providers[provider_id] = {**(providers.get(provider_id) or {}), **entry}
        config['providers'] = providers
        save_config(config, merge_existing=True)

        # Probe the endpoint once so the picker can list its models immediately. A failure is a
        # warning, not an error: the provider is already saved and may simply be offline right now.
        models, warning = [], ''
        try:
            models = self._provider_models(base_url, api_key)
        except Exception as exc:
            warning = f'Saved, but the endpoint did not answer: {exc}'
        return {'id': provider_id, 'label': label, 'baseUrl': base_url,
                'defaultModel': default_model, 'hasKey': bool(api_key),
                'models': models[:200], 'warning': warning}

    def _provider_models(self, base_url, api_key=''):
        """`GET <base>/models` → model ids; raises with the endpoint's own status on failure."""
        import urllib.error
        import urllib.request
        request = urllib.request.Request(base_url.rstrip('/') + '/models',
                                         headers={'Authorization': f'Bearer {api_key}'} if api_key else {})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode('utf-8', 'replace'))
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f'HTTP {exc.code} from {base_url}/models') from exc
        rows = payload.get('data') if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            raise RuntimeError('the endpoint did not return a model list')
        return [str(row.get('id')) for row in rows if isinstance(row, dict) and row.get('id')]

    def _subagents(self, cwd):
        """Everything Hermes knows about delegation for this workspace.

        Two sources, kept apart from the editor's own worker presets: the delegation policy from
        `config.yaml` (limits, model) and the subagent runs Hermes persisted (`source='subagent'`, one
        row per delegate_task child, `ended_at` null while live). A run belongs to this workspace
        through its parent conversation, because a child row carries no cwd of its own.
        """
        import os
        from pathlib import Path
        config = {}
        try:
            from hermes_cli.config import load_config
            raw = (load_config() or {}).get('delegation') or {}
            # Policy fields only: api_key/bearer material lives in the same block and must not leave.
            config = {'backend': str(raw.get('backend') or 'default'),
                      'model': str(raw.get('model') or ''),
                      'provider': str(raw.get('provider') or ''),
                      'maxConcurrent': int(raw.get('max_concurrent_children') or 0),
                      'maxDepth': int(raw.get('max_spawn_depth') or 0),
                      'childTimeoutSeconds': int(raw.get('child_timeout_seconds') or 0),
                      'orchestrator': bool(raw.get('orchestrator_enabled', True)),
                      'oneshotMaxChildren': int(raw.get('oneshot_max_children') or 0)}
        except Exception:
            config = {}
        home = Path(os.environ.get('HERMES_HOME') or (Path.home() / '.hermes'))
        path = home / 'state.db'
        if not path.exists():
            return {'policy': config, 'running': [], 'recent': []}
        from hermes_state import SessionDB
        wanted = os.path.normpath(cwd) if cwd else ''
        parents = {}
        children = []
        with SessionDB(db_path=path, read_only=True) as db:
            for row in db.list_sessions_rich(sources=['acp', 'local'], local_created_sources=['acp'],
                                             include_archived=True, limit=300):
                row_cwd = row.get('cwd') or ''
                if wanted and os.path.normpath(row_cwd) != wanted:
                    continue
                parents[str(row.get('id'))] = str(row.get('title') or '')
            children = db.list_sessions_rich(sources=['subagent'], include_subagents=True,
                                             include_archived=True, limit=200)
        runs = []
        for row in children:
            parent = str(row.get('parent_session_id') or '')
            if wanted and parent not in parents:
                continue
            runs.append({'id': str(row.get('id') or ''),
                         'title': str(row.get('title') or 'Subagent run'),
                         'parentTitle': parents.get(parent, 'Another conversation'),
                         'model': str(row.get('model') or ''),
                         'messages': int(row.get('message_count') or 0),
                         'tools': int(row.get('tool_call_count') or 0),
                         'startedAt': row.get('started_at'),
                         'lastActivityAt': row.get('last_active') or row.get('started_at'),
                         'endedAt': row.get('ended_at'),
                         'endReason': str(row.get('end_reason') or '')})
        runs.sort(key=lambda run: float(run.get('startedAt') or 0), reverse=True)
        running = [run for run in runs if not run.get('endedAt')]
        recent = [run for run in runs if run.get('endedAt')][:40]
        return {'policy': config, 'running': running, 'recent': recent}

    def _sessions(self, cwd):
        """Conversations this editor created for one workspace, read from Hermes' own database.

        ACP's ``session/list`` only reports ``source='acp'`` rows, and those are the empty shells a
        bare ``hermes acp`` probe leaves behind — the real transcripts are stored as
        ``source='local'`` with ``created_source='acp'``. Listing through Hermes' DB layer (rather
        than a second copy kept by the editor) means an update, a reinstall or a wiped extension
        index cannot lose a conversation: Hermes owns the record, the editor only remembers which
        id to resume.
        """
        import os
        from pathlib import Path
        home = Path(os.environ.get('HERMES_HOME') or (Path.home() / '.hermes'))
        path = home / 'state.db'
        if not path.exists():
            return []
        from hermes_state import SessionDB
        rows = []
        with SessionDB(db_path=path, read_only=True) as db:
            rows = db.list_sessions_rich(sources=['acp', 'local'], local_created_sources=['acp'],
                                         min_message_count=1, include_archived=True,
                                         order_by_last_active=True, limit=500)
        wanted = os.path.normpath(cwd) if cwd else ''
        kept = []
        for row in rows:
            row_cwd = row.get('cwd') or ''
            if wanted and os.path.normpath(row_cwd) != wanted:
                continue
            kept.append({'id': str(row.get('_lineage_root_id') or row.get('id') or ''),
                         'title': str(row.get('title') or ''),
                         'cwd': row_cwd,
                         'messages': int(row.get('message_count') or 0),
                         'updatedAt': row.get('last_active') or row.get('started_at')})
        return kept[:200]

    async def execute(self, request):
        action = request.get('action')
        if action == 'mistral_discover':
            # Probe one model and cache the answer for both the wire and the selector.
            model = str(request.get('model') or '')[:300]
            if not model:
                raise ValueError('A model is required')
            levels, note = discover_mistral_ladder(model)
            if levels is not None and _mistral_save is not None:
                _mistral_save(model, levels, note)
            return {'model': model, 'levels': list(levels) if levels is not None else None,
                    'note': note,
                    'source': 'discovered' if levels is not None else 'unavailable'}
        if action == 'mistral_models':
            # One request: what the account can actually chat with, with the facts the picker needs.
            rows = _mistral_models()
            listed = []
            for model_id, entry in sorted(rows.items()):
                capabilities = entry.get('capabilities') or {}
                if not capabilities.get('completion_chat'):
                    continue                      # embeddings, OCR, TTS: not selectable models
                ladder = _mistral_efforts(model_id) if _mistral_efforts else None
                listed.append({'id': model_id,
                               'name': str(entry.get('name') or model_id),
                               'description': str(entry.get('description') or '')[:300],
                               'lab': str(entry.get('owned_by') or ''),
                               'context': entry.get('max_context_length'),
                               'aliases': [str(a) for a in (entry.get('aliases') or [])][:8],
                               'capabilities': {key: bool(capabilities.get(key)) for key in
                                                ('reasoning', 'vision', 'function_calling', 'completion_fim')},
                               'labsGated': bool(_mistral_labs and _mistral_labs(model_id)),
                               'efforts': list(ladder) if ladder is not None else None,
                               'effortsSource': ('discovered' if _mistral_discovered and _mistral_discovered(model_id)
                                                 else ('seed' if ladder is not None else 'unknown'))})
            return {'models': listed, 'count': len(listed)}
        if action == 'provider_save':
            return self._provider_save(request)
        if action == 'provider_test':
            # Probe only: nothing is written, so a wrong URL costs one request, not a config edit.
            base_url = str(request.get('baseUrl') or '').strip().rstrip('/')
            if not base_url.startswith(('http://', 'https://')):
                raise ValueError('Base URL must start with http:// or https://')
            try:
                models = self._provider_models(base_url, str(request.get('apiKey') or '').strip())
                return {'ok': True, 'models': models[:200], 'count': len(models)}
            except Exception as exc:
                return {'ok': False, 'error': str(exc)}
        if action == 'subagents':
            return self._subagents(str(request.get('cwd') or ''))
        if action == 'sessions':
            return self._sessions(str(request.get('cwd') or ''))
        if action == 'catalog':
            return EffortCatalog().resolve(str(request.get('provider', '')), str(request.get('model', '')),
                                           str(request.get('baseUrl') or ''))
        if action == 'modelinfo':
            return await self._model_info(str(request.get('provider', '')), str(request.get('model', '')),
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
