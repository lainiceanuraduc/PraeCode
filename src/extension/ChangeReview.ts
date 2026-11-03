import * as vscode from 'vscode';
import path from 'node:path';
import {ChangeJournal} from '../infrastructure/ChangeJournal';
import {diffSides, SnapshotRegistry, SCHEME} from './review/DiffDocuments';
import {revertBlocker} from './review/revertGuard';
import type {ConversationSession} from '../application/SessionController';
import type {ChangeSummary} from '../domain/Changes';

/**
 * VS Code adapter for the review journal: read-only snapshot documents, a native diff, and explicit
 * Keep/Revert actions. It never grants a tool permission — approving Hermes is `PermissionBroker`.
 *
 * The decisions live outside `vscode` (`review/DiffDocuments`, `review/revertGuard`, the journal), so
 * this file only registers providers and asks the user.
 */
export class ChangeReview implements vscode.Disposable {
  readonly journal: ChangeJournal;
  private readonly snapshots = new SnapshotRegistry(40);
  private readonly registration: vscode.Disposable;
  private readonly closeListener: vscode.Disposable;

  constructor(
    storage: string | undefined,
    private readonly profile: () => string,
    private readonly sessions: () => ConversationSession[],
    private readonly changed: () => void
  ) {
    this.journal = new ChangeJournal(storage);
    this.registration = vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      provideTextDocumentContent: uri => this.snapshots.get(uri.toString())
    });
    this.closeListener = vscode.workspace.onDidCloseTextDocument(document => {
      if (document.uri.scheme === SCHEME) this.snapshots.forget(document.uri.toString());
    });
  }

  list(): ChangeSummary[] {
    return this.journal.list(this.profile());
  }

  /** Record an edit from the ACP stream; a replay after a resume is not a new change. */
  observe(sessionId: string, update: any): void {
    if (!['tool_call', 'tool_call_update'].includes(update?.sessionUpdate)) return;
    const session = this.sessions().find(candidate => candidate.id === sessionId);
    if (!session || !['running', 'cancelling'].includes(session.status)) return;
    this.journal.observe(this.profile(), sessionId, session.cwd, update, true);
    this.changed();
  }

  /** Anything still pending after a turn ends can never be attributed; say so instead of guessing. */
  settle(): void {
    for (const session of this.sessions()) if (!session.busy) this.journal.settleSession(this.profile(), session.id);
  }

  async open(id: string): Promise<void> {
    const record = this.journal.get(id, this.profile());
    if (!record.canReview) throw new Error(record.note || 'No complete preview was supplied');
    const sides = diffSides(record.id, record.path, record.before, record.after,
      record.state === 'unavailable');
    this.snapshots.set(sides.left, record.before ?? '');
    this.snapshots.set(sides.right, record.after ?? '');
    await vscode.commands.executeCommand('vscode.diff',
      vscode.Uri.parse(sides.left), vscode.Uri.parse(sides.right), sides.title, {preview: false});
  }

  keep(id: string): void {
    this.journal.keep(id, this.profile());
    this.changed();
  }

  clear(): void {
    this.journal.clearReviewed(this.profile());
    this.changed();
  }

  /** Why a revert of this file is currently refused, if it is. */
  blocker(target: string): string | undefined {
    const sessions = this.sessions();
    return revertBlocker({
      trusted: vscode.workspace.isTrusted,
      busy: sessions.filter(session => session.busy || session.status === 'running').length,
      disconnected: sessions.filter(session => session.status === 'disconnected').length,
      dirtyPaths: vscode.workspace.textDocuments
        .filter(document => document.isDirty && document.uri.scheme === 'file')
        .map(document => document.uri.fsPath),
      workspaceRoots: (vscode.workspace.workspaceFolders ?? [])
        .filter(folder => folder.uri.scheme === 'file')
        .map(folder => folder.uri.fsPath)
    }, target);
  }

  async revert(id: string): Promise<void> {
    const profile = this.profile();
    const record = this.journal.get(id, profile);
    const blocked = this.blocker(record.path);
    if (blocked) throw new Error(blocked);
    if (record.state !== 'ready') throw new Error('This change is not eligible for automatic rollback');
    const choice = await vscode.window.showWarningMessage(
      `Revert ${path.basename(record.path)} to its captured before-image? This changes the file on disk, not Hermes conversation history. Stop other agents and external writers first.`,
      {modal: true}, 'Revert change');
    if (choice !== 'Revert change') return;
    // Re-check after the modal: a turn can start while it is open.
    const late = this.blocker(record.path);
    if (late) throw new Error(late);
    if (profile !== this.profile()) throw new Error('Profile changed; reopen the review');
    const roots = (vscode.workspace.workspaceFolders ?? [])
      .filter(folder => folder.uri.scheme === 'file')
      .map(folder => folder.uri.fsPath);
    try {
      this.journal.revert(id, profile, roots);
    } finally {
      this.changed();
    }
  }

  async pick(): Promise<void> {
    const rows = this.list();
    const item = await vscode.window.showQuickPick(
      rows.map(row => ({label: path.basename(row.path), description: `${row.state} · ${row.sessionId}`, detail: row.note, id: row.id})),
      {title: 'PraeCode: Review changes', placeHolder: 'Captured changes only — shell and unsupported edits are not covered'});
    if (!item) return;
    const record = this.journal.get(item.id, this.profile());
    const choices = [
      ...(record.canReview ? ['Review diff'] : []),
      ...(['ready', 'unavailable'].includes(record.state) ? ['Keep'] : []),
      ...(record.state === 'ready' ? ['Revert'] : [])
    ];
    const action = await vscode.window.showQuickPick(choices, {title: path.basename(record.path), placeHolder: record.note});
    if (action === 'Review diff') await this.open(record.id);
    else if (action === 'Keep') this.keep(record.id);
    else if (action === 'Revert') await this.revert(record.id);
  }

  dispose(): void {
    this.registration.dispose();
    this.closeListener.dispose();
    this.snapshots.clear();
  }
}
