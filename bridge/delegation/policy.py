"""Delegation state for the Subagents tab: Hermes' policy plus the child runs it persisted.

A child row carries no cwd, so a run belongs to this workspace through its parent conversation.
"""
from __future__ import annotations

import os
from pathlib import Path

from sessions.listing import state_db_path


def _policy():
    """The `delegation:` block, policy fields only — api_key material lives there too."""
    try:
        from hermes_cli.config import load_config
        raw = (load_config() or {}).get('delegation') or {}
        return {'backend': str(raw.get('backend') or 'default'),
                'model': str(raw.get('model') or ''),
                'provider': str(raw.get('provider') or ''),
                'maxConcurrent': int(raw.get('max_concurrent_children') or 0),
                'maxDepth': int(raw.get('max_spawn_depth') or 0),
                'childTimeoutSeconds': int(raw.get('child_timeout_seconds') or 0),
                'orchestrator': bool(raw.get('orchestrator_enabled', True)),
                'oneshotMaxChildren': int(raw.get('oneshot_max_children') or 0)}
    except Exception:
        return {}


def snapshot(cwd):
    """``{policy, running, recent}`` for one workspace."""
    policy = _policy()
    path = state_db_path()
    if not path.exists():
        return {'policy': policy, 'running': [], 'recent': []}
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
    return {'policy': policy,
            'running': [run for run in runs if not run.get('endedAt')],
            'recent': [run for run in runs if run.get('endedAt')][:40]}
