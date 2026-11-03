"""Mistral ladders and model discovery.

The table ships beside the bundled provider profile so the wire and the selector cannot disagree; it
is loaded by path because this bridge runs outside the plugin package.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from net import open_once

MISTRAL_NATIVE_EFFORTS = ('none', 'high')

_plugin_dir = str(Path(__file__).resolve().parents[2] / 'hermes-plugin' / 'mistral')
if _plugin_dir not in sys.path:
    sys.path.insert(0, _plugin_dir)

try:
    from mistral_ladders import (  # noqa: E402 - path set up above
        efforts_for_model as _efforts,
        note_for_model as _note,
        is_labs_model as _labs,
        parse_refusal as _parse,
        save_cache_entry as _save,
        static_ladder as _static,
        discovered_ladder as _discovered,
        PROBE_CANDIDATES as _probe_levels,
    )
except Exception:  # pragma: no cover - the extension always ships the table; a bare copy may not
    _efforts = _note = _labs = _parse = _save = _static = _discovered = None
    _probe_levels = ()

efforts_for_model = _efforts
note_for_model = _note
is_labs_model = _labs
parse_refusal = _parse
save_cache_entry = _save
static_ladder = _static
discovered_ladder = _discovered
PROBE_LEVELS = _probe_levels


def api_key():
    """The API key for this profile, from the environment or Hermes' own .env. Never logged."""
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


def _post(path, key, payload, timeout=60):
    """One HTTPS POST to api.mistral.ai; returns ``(status, body)``. Redirects are refused."""
    import urllib.error
    import urllib.request

    request = urllib.request.Request(
        'https://api.mistral.ai/v1' + path,
        data=json.dumps(payload).encode(),
        headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    try:
        with open_once(request, timeout=timeout) as response:
            return response.status, response.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode('utf-8', 'replace')
    except Exception as exc:  # network, DNS, timeout: unknown, never a guess
        return 0, str(exc)


def discover_ladder(model, key=''):
    """``(levels, note)`` for one model, probing the API; ``(None, note)`` when it cannot be known."""
    if _labs is not None and _labs(model):
        return None, 'labs_gated'
    key = key or api_key()
    if not key:
        return None, 'no_api_key'
    for level in _probe_levels or ('xhigh', 'none', 'minimal', 'medium', 'low', 'max'):
        status, body = _post('/chat/completions', key,
                             {'model': model, 'max_tokens': 1, 'reasoning_effort': level,
                              'messages': [{'role': 'user', 'content': 'hi'}]})
        if status == 200:
            continue  # this model accepts `level`: try the next candidate
        if status == 403:
            return None, 'labs_gated'
        if status == 400:
            levels = _parse(body) if _parse else None
            if levels is not None:
                return levels, ''
        return None, f'http_{status}'
    # Every candidate was accepted, so the model takes the whole enum.
    return ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'), ''


def models(key=''):
    """``GET /v1/models`` as ``{id: entry}``; empty when unavailable. One request, no probing."""
    import urllib.request

    key = key or api_key()
    if not key:
        return {}
    request = urllib.request.Request('https://api.mistral.ai/v1/models',
                                     headers={'Authorization': f'Bearer {key}'})
    try:
        with open_once(request, timeout=30) as response:
            payload = json.loads(response.read().decode('utf-8', 'replace'))
    except Exception:
        return {}
    rows = payload.get('data') if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return {}
    return {str(row.get('id')): row for row in rows if isinstance(row, dict) and row.get('id')}
