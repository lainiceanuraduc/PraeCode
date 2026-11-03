"""Conversations Hermes persists for this workspace.

ACP's own ``session/list`` reports only ``source='acp'`` rows (the empty ``local-<hash>`` shells a bare
``hermes acp`` probe leaves), while real editor transcripts are stored ``source='local'`` with
``created_source='acp'``. That is why this reads the database directly, and why the bounds below are
part of the contract rather than an implementation detail.
"""
from __future__ import annotations

import os
from pathlib import Path

#: Candidate rows examined before the workspace filter — a bound, not "every conversation".
CANDIDATE_LIMIT = 500
#: Rows returned to the editor.
RETURN_LIMIT = 200


def state_db_path(home=None):
    return Path(home or os.environ.get('HERMES_HOME') or (Path.home() / '.hermes')) / 'state.db'


def list_sessions(cwd):
    """Sessions the editor can resume for ``cwd``, newest first. Read-only; never creates the database."""
    path = state_db_path()
    if not path.exists():
        return []
    from hermes_state import SessionDB
    rows = []
    with SessionDB(db_path=path, read_only=True) as db:
        rows = db.list_sessions_rich(sources=['acp', 'local'], local_created_sources=['acp'],
                                     min_message_count=1, include_archived=True,
                                     order_by_last_active=True, limit=CANDIDATE_LIMIT)
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
    return kept[:RETURN_LIMIT]
