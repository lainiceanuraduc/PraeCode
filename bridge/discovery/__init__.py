"""Model discovery: ladders, routes, effort catalogs and per-model facts.

These modules never touch the VS Code side; they answer "what does this provider/model accept?" for
the selector and for the detail pane, from the API, the bundled table or Hermes' own policy.
"""
from discovery import mistral  # noqa: F401 - imported first: routes/efforts read it
from discovery import routes  # noqa: F401
from discovery import efforts  # noqa: F401
from discovery import modelinfo  # noqa: F401

from discovery.efforts import EffortCatalog
from discovery.mistral import (
    MISTRAL_NATIVE_EFFORTS,
    discover_ladder,
    efforts_for_model,
    is_labs_model,
    models,
    note_for_model,
    parse_refusal,
    save_cache_entry,
    static_ladder,
    discovered_ladder,
)
from discovery.modelinfo import model_info, summarize
from discovery.routes import (
    MISTRAL_CLOUD_EFFORTS,
    MISTRAL_CLOUD_NOTE,
    MISTRAL_NATIVE_NOTE,
    MISTRAL_UNVERIFIED_NOTE,
    OLLAMA_CLOUD_NOTE,
    OLLAMA_LOCAL_NOTE,
    OPENAI_DIRECT_NOTE,
    OPENROUTER_NOTE,
    OPENROUTER_OFF_NOTE,
    OPENROUTER_UNLISTED_NOTE,
    clamp_mistral,
    host,
    is_mistral_model,
    is_mistral_profile,
    is_ollama_cloud,
    is_ollama_local,
    is_ollama_route,
    is_openai_host,
    is_openrouter_host,
    mistral_native_route,
    provider_is_mistral,
    route_efforts,
)

__all__ = [
    'EffortCatalog', 'MISTRAL_CLOUD_EFFORTS', 'MISTRAL_CLOUD_NOTE', 'MISTRAL_NATIVE_EFFORTS',
    'MISTRAL_NATIVE_NOTE', 'MISTRAL_UNVERIFIED_NOTE', 'OLLAMA_CLOUD_NOTE', 'OLLAMA_LOCAL_NOTE',
    'OPENAI_DIRECT_NOTE', 'OPENROUTER_NOTE', 'OPENROUTER_OFF_NOTE', 'OPENROUTER_UNLISTED_NOTE',
    'clamp_mistral', 'discover_ladder', 'discovered_ladder', 'efforts_for_model', 'host', 'is_labs_model',
    'is_mistral_model', 'is_mistral_profile', 'is_ollama_cloud', 'is_ollama_local',
    'is_ollama_route', 'is_openai_host', 'is_openrouter_host', 'mistral_native_route', 'model_info',
    'models', 'note_for_model', 'parse_refusal', 'provider_is_mistral', 'route_efforts',
    'save_cache_entry', 'static_ladder', 'summarize',
]
