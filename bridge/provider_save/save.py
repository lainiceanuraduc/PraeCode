"""Add or update a provider in Hermes' own configuration.

Written through ``hermes_cli.config.save_config`` (not by editing YAML here), so the file keeps its
schema handling and unknown-key notices. The API key goes to the profile's ``.env`` under
``<ID>_API_KEY`` and the config stores only that variable's *name* — a key never lands in
``config.yaml``, which is the file people paste into issues.
"""
from __future__ import annotations

import contextlib
import os
import re
from pathlib import Path

from provider_save import endpoint


def _profile_home():
    return Path(os.environ.get('HERMES_HOME') or (Path.home() / '.hermes'))


def _write_env_key(env_path, key_env, api_key):
    """Replace one variable atomically, in a file that is never world-readable, even briefly."""
    if '\n' in api_key or '\r' in api_key:
        raise ValueError('The API key must not contain line breaks')
    lines = []
    if env_path.exists():
        lines = [line for line in env_path.read_text().splitlines() if not line.startswith(f'{key_env}=')]
    lines.append(f'{key_env}={api_key}')
    temporary = env_path.with_name(f'{env_path.name}.{os.getpid()}.tmp')
    with contextlib.suppress(FileNotFoundError):
        temporary.unlink()
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            handle.write('\n'.join(lines) + '\n')
        os.replace(temporary, env_path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()
        raise
    with contextlib.suppress(OSError):
        os.chmod(env_path, 0o600)


def save_provider(request):
    """Add or update one entry in the selected profile's ``providers:`` block."""
    provider_id = str(request.get('id') or '').strip().lower()
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,39}', provider_id or ''):
        raise ValueError('Provider id must be lowercase letters, digits, dots or hyphens (max 40)')
    base_url = endpoint.provider_base_url(request.get('baseUrl'))
    if not endpoint.is_api_root(base_url):
        raise ValueError('Base URL must start with http:// or https://')
    label = str(request.get('label') or provider_id).strip()[:60]
    default_model = str(request.get('defaultModel') or '').strip()[:200]
    api_key = str(request.get('apiKey') or '').strip()

    home = _profile_home()
    key_env = ''
    if api_key:
        key_env = f"{provider_id.upper().replace('-', '_').replace('.', '_')}_API_KEY"
        _write_env_key(home / '.env', key_env, api_key)

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

    # Hermes' generic discovery uses <chat base>/models. Persist Mammouth's separate public catalog as
    # declared models so new ACP processes can populate their own model selector.
    models, warning = [], ''
    mammouth = endpoint.mammouth_route(base_url)
    if mammouth:
        entry.update({'api_mode': 'chat_completions', 'discover_models': False})
        try:
            models = endpoint.models(base_url)
            if not models:
                raise RuntimeError('Mammouth catalog returned no chat candidates')
            entry['models'] = models[:200]
            if not default_model:
                default_model = 'mammouth-recommended' if 'mammouth-recommended' in models else models[0]
                entry.update({'model': default_model, 'default_model': default_model})
        except Exception as exc:
            warning = f'{exc}. Supply a default model or Save again to refresh the Mammouth catalog.'
    providers[provider_id] = {**(providers.get(provider_id) or {}), **entry}
    config['providers'] = providers
    save_config(config, merge_existing=True)

    # Generic endpoints keep their post-save probe; failure does not undo a saved provider.
    if not mammouth:
        try:
            models = endpoint.models(base_url, api_key)
        except Exception as exc:
            warning = f'Saved, but the endpoint did not answer: {exc}'
    return {'id': provider_id, 'label': label, 'baseUrl': base_url,
            'defaultModel': default_model, 'hasKey': bool(api_key),
            'models': models[:200], 'warning': warning}


def test_provider(request):
    """Probe an endpoint without writing anything, so a wrong URL costs one request, not a config edit."""
    base_url = str(request.get('baseUrl') or '').strip().rstrip('/')
    if not endpoint.is_api_root(base_url):
        raise ValueError('Base URL must start with http:// or https://')
    try:
        models = endpoint.models(base_url, str(request.get('apiKey') or '').strip())
        return {'ok': True, 'models': models[:200], 'count': len(models),
                'catalogOnly': endpoint.mammouth_route(base_url)}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}
