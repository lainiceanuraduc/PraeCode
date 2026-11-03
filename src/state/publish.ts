/**
 * One state object, built from the host and pushed to the webview.
 *
 * The webview is a pure projection of this, so everything it renders is assembled here — and every
 * value is the already-validated one (settings are clamped in `Settings`, paths come from the editor).
 */
import * as vscode from 'vscode';
import {editorContext} from '../extension/Inputs';
import {appearance} from '../extension/Settings';
import type {ExtensionHost} from '../extension/host';

export function buildState(host: ExtensionHost): Record<string, unknown> {
  const service = host.service;
  const sessions = service?.sessions ?? [];
  const activeId = service?.activeId ?? '';
  if (activeId) host.recent.setActive(activeId);

  const recent = host.recent.merge(sessions.map(s => ({id: s.id, title: s.title, cwd: s.cwd})));

  // The live `usage_update` stream is fresher than any inspect, so it wins over the cached info.
  const usage = service?.usage(activeId);
  if (usage) {
    const active = sessions.find(s => s.id === activeId);
    if (active?.info) active.info.context = {...usage};
  }

  return {
    type: 'state',
    sessions,
    activeId,
    presets: host.presets.list(),
    recent: recent.filter(entry => entry.profile === host.profile),
    changes: host.changes.list(),
    changesNotice: host.changes.journal.notice,
    maxWorkers: vscode.workspace.getConfiguration('radcode').get('maxParallelAgents', 2),
    editor: editorContext(),
    appearance: appearance(host.context.globalState.get<number>('radcode.textSize'))
  };
}
