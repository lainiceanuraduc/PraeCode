"""Which effort ladder a route accepts, and the notes that explain a ladder to the user.

One function — ``route_efforts`` — decides for both the catalog and the effort mutation, so the
selector and the wire cannot disagree. Branching is on the **route**, never the model name alone: Z.ai
models are served *by* Mistral, and ``mistral-large-latest`` is Large 3 with reasoning disabled.
"""
from __future__ import annotations

from urllib.parse import urlsplit

from discovery import mistral

MISTRAL_NATIVE_NOTE = ("Mistral API ladder: none or high. Mistral rejects every other level "
                       "(minimal/low/medium/xhigh/max) with HTTP 400, so they are not offered.")
MISTRAL_UNVERIFIED_NOTE = ("This Mistral model has not been verified against the API, so no level is "
                           "offered rather than one that would fail at the provider.")
# Ollama Cloud's OpenAI-compatible endpoint accepts these for Mistral models (verified live).
MISTRAL_CLOUD_EFFORTS = ('none', 'low', 'medium', 'high')
MISTRAL_CLOUD_NOTE = ("Ollama Cloud ladder for Mistral: none, low, medium, high. Ollama accepts these; "
                      "xhigh and max clamp down to high.")
OLLAMA_CLOUD_NOTE = ('Ollama Cloud ladder (all hosted models): none, low, medium, high, max. '
                     'Hermes maps xhigh to max; thinking is on by default, so none is the off switch.')
OLLAMA_LOCAL_NOTE = ('Local Ollama: the ladder Hermes can send (`think` levels). Which levels a specific '
                     'model really uses is published by /api/show; Hermes clamps anything else.')
OPENROUTER_NOTE = ('OpenRouter ladder for this model, from its published reasoning metadata. '
                   'Hermes clamps to the same catalog at request time.')
OPENROUTER_UNLISTED_NOTE = ('OpenRouter has no reasoning metadata cached for this model yet. Offering the '
                            'OpenAI-compatible set: Hermes clamps per model on the wire, so an unsupported '
                            'level is reduced rather than rejected.')
OPENROUTER_OFF_NOTE = 'This OpenRouter model does not accept reasoning controls.'
OPENAI_DIRECT_NOTE = ('OpenAI ladder for this model generation. Hermes maps minimal down and offers max '
                      'only where the model accepts it.')

_MISTRAL_PREFIXES = ('mistral-', 'mistral_', 'magistral', 'ministral', 'codestral', 'voxtral',
                     'pixtral', 'labs-leanstral', 'mistral')


def host(base_url):
    try:
        return (urlsplit(str(base_url or '')).hostname or '').lower()
    except ValueError:
        return ''


def is_ollama_route(provider, base_url=''):
    name = host(base_url)
    return 'ollama' in str(provider or '').lower() or name == 'ollama.com' or name.endswith('.ollama.com') \
        or name in {'localhost', '127.0.0.1'} and ':11434' in str(base_url or '')


def is_openrouter_host(base_url):
    name = host(base_url)
    return name == 'openrouter.ai' or name.endswith('.openrouter.ai')


def is_openai_host(base_url):
    name = host(base_url)
    return name == 'api.openai.com' or name.endswith('.openai.com')


def is_mistral_model(model):
    bare = str(model or '').strip().lower().rsplit('/', 1)[-1]
    return any(bare.startswith(prefix) for prefix in _MISTRAL_PREFIXES)


def is_ollama_local(provider, base_url):
    """A daemon on the user's machine, as opposed to the Cloud fleet."""
    return is_ollama_route(provider, base_url) and not is_ollama_cloud(provider, base_url)


def is_ollama_cloud(provider, base_url):
    """Cloud fleet, by host or by provider name — a session's baseUrl is often blank."""
    name = host(base_url)
    if name == 'ollama.com' or name.endswith('.ollama.com'):
        return True
    return 'cloud' in str(provider or '').lower()


def mistral_native_route(provider, base_url=''):
    """True when requests actually go to api.mistral.ai (any model, including the Z.ai ones)."""
    return str(provider or '').strip().lower() in {'mistral', 'mistralai'} \
        or host(base_url) == 'api.mistral.ai'


def openrouter_capabilities(model):
    """Per-model reasoning metadata from OpenRouter's own catalog, or None when unknown."""
    try:
        from hermes_cli.models_reasoning_caps import openrouter_model_reasoning_capabilities
        return openrouter_model_reasoning_capabilities(model, timeout=8.0, allow_fetch=True)
    except Exception:
        # An unreachable catalog must degrade to "unknown", never to an exception or a guess.
        return None


def route_efforts(provider, model, base_url=''):
    """The exact ladder this route accepts, or ``None`` when the route is not decided here."""
    if mistral_native_route(provider, base_url):
        if mistral.efforts_for_model is None:  # pragma: no cover - the table ships with the extension
            return mistral.MISTRAL_NATIVE_EFFORTS
        if mistral.is_labs_model is not None and mistral.is_labs_model(model):
            return ()  # gated per organisation: every request is a 403
        return mistral.efforts_for_model(model)
    if is_ollama_route(provider, base_url):
        from agent.reasoning_effort import OLLAMA_CLOUD_EFFORTS
        return MISTRAL_CLOUD_EFFORTS if is_mistral_model(model) else OLLAMA_CLOUD_EFFORTS
    return None


def is_mistral_profile(profile):
    """True only for the bundled plugin profile (declares our exact ladder), not a hypothetical one."""
    try:
        expected = (mistral.static_ladder('mistral-large-4') if mistral.static_ladder is not None
                    else mistral.MISTRAL_NATIVE_EFFORTS)
        return tuple(profile.supported_reasoning_efforts('mistral-large-4') or ()) == tuple(expected or ())
    except Exception:
        return False


def clamp_mistral(effort, cloud=False):
    """Nearest-weaker clamp onto the Mistral ladder the route actually accepts."""
    from agent.reasoning_effort import clamp_effort
    return clamp_effort(effort, MISTRAL_CLOUD_EFFORTS if cloud else mistral.MISTRAL_NATIVE_EFFORTS)


def provider_is_mistral(public):
    """True when this session's request actually goes to a Mistral ladder (native or Ollama)."""
    provider = str(public.get('provider') or '').strip().lower()
    return (is_mistral_model(public.get('model')) and
            (provider in {'mistral', 'mistralai'} or is_ollama_route(provider, public.get('baseUrl'))) or
            host(public.get('baseUrl')) == 'api.mistral.ai')
