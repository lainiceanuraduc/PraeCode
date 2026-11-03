"""Narrow, version-gated local bridge. Never emits config, tokens or credentials.

The protocol is one JSON request on stdin and one JSON result on stdout; Hermes' runtime executes this
file. Each concern lives beside it and this file only routes:

    discovery/      effort ladders, routes and per-model facts
    provider_save/  adding a provider and probing an endpoint
    sessions/       the conversations the editor can resume
    delegation/     Hermes' delegation policy and child runs
    rpc/            fenced session RPC (info, effort, rename, compact)
    net.py          one-shot HTTP that refuses redirects

The names re-exported below are the bridge's public surface: the extension spawns it for one action,
and the tests import it directly.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import sys

# Both entry points put this directory on sys.path (Hermes' launcher and the test loader), because the
# packages beside this file are imported as top-level modules, not as part of an installed package.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from delegation import snapshot as delegation_snapshot  # noqa: E402
from discovery import (  # noqa: E402
    EffortCatalog,
    MISTRAL_CLOUD_EFFORTS,
    MISTRAL_NATIVE_EFFORTS,
    MISTRAL_NATIVE_NOTE,
    clamp_mistral,
    discover_ladder,
    discovered_ladder,
    efforts_for_model,
    is_labs_model,
    is_mistral_model,
    mistral_native_route,
    model_info,
    models as mistral_models,
    note_for_model,
    parse_refusal,
    provider_is_mistral,
    route_efforts,
    save_cache_entry,
    static_ladder,
    summarize,
)
from provider_save import mammouth_route, provider_base_url  # noqa: E402
from provider_save import models as provider_models  # noqa: E402
from provider_save import save_provider, test_provider  # noqa: E402
from rpc import compact_session, public_info, rename_session, require_session_id, session_state  # noqa: E402
from sessions import list_sessions  # noqa: E402

#: Names the previous single-module bridge exposed; kept so callers and tests read the same surface.
summarize_model = summarize
discover_mistral_ladder = discover_ladder


def _mistral_listing():
    """Chat-capable Mistral models with the facts the picker shows, from one request."""
    listed = []
    for model_id, entry in sorted(mistral_models().items()):
        capabilities = entry.get('capabilities') or {}
        if not capabilities.get('completion_chat'):
            continue  # embeddings, OCR, TTS: not selectable models
        ladder = efforts_for_model(model_id) if efforts_for_model else None
        listed.append({'id': model_id,
                       'name': str(entry.get('name') or model_id),
                       'description': str(entry.get('description') or '')[:300],
                       'lab': str(entry.get('owned_by') or ''),
                       'context': entry.get('max_context_length'),
                       'aliases': [str(alias) for alias in (entry.get('aliases') or [])][:8],
                       'capabilities': {key: bool(capabilities.get(key)) for key in
                                        ('reasoning', 'vision', 'function_calling', 'completion_fim')},
                       'labsGated': bool(is_labs_model and is_labs_model(model_id)),
                       'efforts': list(ladder) if ladder is not None else None,
                       'effortsSource': ('discovered' if discovered_ladder and discovered_ladder(model_id)
                                         else ('seed' if ladder is not None else 'unknown'))})
    return {'models': listed, 'count': len(listed)}


class HermesSessionControl:
    """One action per invocation. Thin on purpose: each action lives in its own package."""

    async def execute(self, request):
        action = request.get('action')
        if action == 'mistral_discover':
            # Probe one model and cache the answer for both the wire and the selector.
            model = str(request.get('model') or '')[:300]
            if not model:
                raise ValueError('A model is required')
            levels, note = discover_ladder(model)
            if levels is not None and save_cache_entry is not None:
                save_cache_entry(model, levels, note)
            return {'model': model, 'levels': list(levels) if levels is not None else None,
                    'note': note,
                    'source': 'discovered' if levels is not None else 'unavailable'}
        if action == 'mistral_models':
            return _mistral_listing()
        if action == 'provider_save':
            return save_provider(request)
        if action == 'provider_test':
            return test_provider(request)
        if action == 'subagents':
            return delegation_snapshot(str(request.get('cwd') or ''))
        if action == 'sessions':
            return list_sessions(str(request.get('cwd') or ''))
        if action == 'catalog':
            return EffortCatalog().resolve(str(request.get('provider', '')), str(request.get('model', '')),
                                           str(request.get('baseUrl') or ''))
        if action == 'modelinfo':
            return await model_info(str(request.get('provider', '')), str(request.get('model', '')),
                                    str(request.get('baseUrl') or ''))
        if action not in ('inspect', 'effort', 'rename', 'compact'):
            raise ValueError('Unsupported bridge action')
        sid = require_session_id(request)
        if action == 'rename':
            return await rename_session(sid, request.get('title'))
        if action == 'compact':
            return await compact_session(sid, request.get('focus') or '')
        return await session_state(action, sid, request.get('value'))

    # --- thin shims: the RPC and provider actions are also exercised directly by the tests -------

    async def _rename(self, sid, title):
        return await rename_session(sid, title)

    async def _compact(self, sid, focus):
        return await compact_session(sid, focus)

    def _provider_save(self, request):
        return save_provider(request)

    def _provider_models(self, base_url, api_key=''):
        return provider_models(base_url, api_key)

    def _subagents(self, cwd):
        return delegation_snapshot(cwd)

    def _sessions(self, cwd):
        return list_sessions(cwd)

    async def _model_info(self, provider, model, base_url):
        return await model_info(provider, model, base_url)


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
