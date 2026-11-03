"""One user-supplied endpoint: URL rules and the model-list probe.

Everything here talks to an endpoint the user typed, so the rules are narrow: the URL must be an
HTTP(S) API root, and each request is made exactly once (a redirect is refused, because urllib would
copy the `Authorization` header onto the new request and hand the key to another host).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from net import open_once


def mammouth_route(base_url):
    """Only the documented HTTPS API root; never redirect a lookalike host or custom path."""
    try:
        parsed = urlsplit(str(base_url or '').strip())
        return (parsed.scheme == 'https' and parsed.hostname == 'api.mammouth.ai'
                and parsed.port in (None, 443) and not parsed.username and not parsed.password
                and not parsed.query and not parsed.fragment
                and parsed.path.rstrip('/') in ('', '/v1'))
    except ValueError:
        return False


def provider_base_url(base_url):
    base = str(base_url or '').strip().rstrip('/')
    return 'https://api.mammouth.ai/v1' if mammouth_route(base) else base


def is_api_root(base_url):
    return str(base_url or '').startswith(('http://', 'https://'))


def models(base_url, api_key=''):
    """``GET <base>/models`` → model ids; raises with the endpoint's own status on failure."""
    mammouth = mammouth_route(base_url)
    url = 'https://api.mammouth.ai/public/models' if mammouth else base_url.rstrip('/') + '/models'
    # The catalog is public. Never send the user's chat credential to it.
    request = urllib.request.Request(url, headers={'User-Agent': 'PraeCode', **(
        {'Authorization': f'Bearer {api_key}'} if api_key and not mammouth else {})})
    try:
        with open_once(request, timeout=15) as response:
            payload = json.loads(response.read().decode('utf-8', 'replace'))
    except urllib.error.HTTPError as exc:
        if 300 <= exc.code < 400:
            raise RuntimeError(f'The endpoint redirected ({exc.code}); a redirect is refused so your '
                               f'key is never sent elsewhere. Use the API base URL directly.') from exc
        raise RuntimeError(f'HTTP {exc.code} from {url}') from exc
    rows = payload.get('data') if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise RuntimeError('the endpoint did not return a model list')
    found = [str(row.get('id')) for row in rows if isinstance(row, dict) and row.get('id')]
    if mammouth:
        # The public catalog mixes chat, embeddings and image generation without a type field.
        found = [model for model in found if not any(part in model.lower() for part in
                 ('embedding', 'image', 'nano-banana', 'whisper', 'tts', 'dall-e', 'flux', 'stable-diffusion'))]
    return list(dict.fromkeys(found))
