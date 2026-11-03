"""Fenced session RPC: info, effort, rename, compaction.

Each call re-reads the session afterwards, because RPC acceptance is not proof that the change landed.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import uuid

from discovery import EffortCatalog, route_efforts


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


async def rename_session(sid, title):
    """A metadata edit: ``session.mutate rename`` with the revision fence, no generation fence.

    ``/title`` is deliberately not used: ACP runs slash commands against a transient session that
    never reaches the session DB, so the new title would vanish on the next load.
    """
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


async def compact_session(sid, focus):
    """Manual compaction as a fenced ``session.mutate compress`` — the mutation ``/compress`` uses."""
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


async def session_state(action, sid, effort=None):
    """Inspect a session, or apply + confirm a reasoning-effort change."""
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
                ladder = route_efforts(public['provider'], public['model'], public['baseUrl'])
                if effort != 'default' and ladder:
                    # The UI only offers supported levels; clamp a stale or preset value onto this
                    # model's real ladder (GLM has no 'none', Ministral has no field at all) instead
                    # of letting the provider 400, then report what Hermes actually stored.
                    from agent.reasoning_effort import clamp_effort
                    effort = clamp_effort(effort, ladder)
                if effort != 'default' and effort not in caps['values']:
                    raise ValueError('Unsupported effort for the active provider/model')
                await PreparedMutations().apply(client, sid, 'reasoning',
                                                {'effort': None if effort == 'default' else effort})
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


def require_session_id(request):
    sid = request.get('sessionId')
    if not isinstance(sid, str) or not sid or len(sid) > 256:
        raise ValueError('A valid sessionId is required')
    return sid
