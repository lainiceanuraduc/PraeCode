"""Model facts for the picker's detail pane (lab, context window, ladder), with no invented numbers."""
from __future__ import annotations

import asyncio

from discovery import efforts, mistral, routes


def _positive_int(entry, *names):
    for name in names:
        value = entry.get(name) if isinstance(entry, dict) else None
        if isinstance(value, int) and value > 0:
            return value
    return None


def summarize(provider, model, base_url='', endpoint_entry=None, catalog_entry=None,
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


async def model_info(provider, model, base_url):
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
    if routes.mistral_native_route(provider, resolved) and model:
        listed = await asyncio.to_thread(mistral.models)
        entry = listed.get(model) if isinstance(listed, dict) else None
        if isinstance(entry, dict):
            endpoint_entry = {**(endpoint_entry or {}), **entry}
    label = ''
    try:
        from hermes_cli.providers import get_label
        label = str(get_label(provider) or '')
    except Exception:
        label = ''
    caps = efforts.EffortCatalog().resolve(provider, model, resolved)
    return summarize(provider, model, resolved, endpoint_entry, catalog_entry, caps, label)
