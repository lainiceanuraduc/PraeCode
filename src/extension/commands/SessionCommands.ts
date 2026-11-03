/**
 * Conversation commands: create, resume, rename, compact, attach a selection, send a turn.
 *
 * These are the paths that change what the user sees in the transcript, so each one publishes state
 * when it ends and leaves error reporting to the caller's boundary.
 */
import * as vscode from 'vscode';
import {readAttachments, readImages} from '../Inputs';
import type {ExtensionHost} from '../host';
import type {RecentSession} from '../../domain/RecentSessions';

interface ResumeItem extends vscode.QuickPickItem {
  session: RecentSession;
}

export class SessionCommands {
  private creation?: Promise<void>;
  private restoring?: Promise<void>;
  private restored = false;

  constructor(private readonly host: ExtensionHost) {}

  async newSession(): Promise<void> {
    if (this.creation) return this.creation;
    this.creation = (async () => {
      await this.host.view.open();
      await this.host.controller.create();
      this.host.publish();
      this.host.view.post({type: 'showChat'});
    })().finally(() => {
      this.creation = undefined;
    });
    return this.creation;
  }

  async history(): Promise<void> {
    const controller = this.host.controller;
    const recent = this.host.recent.forProfile();
    const pick = await vscode.window.showQuickPick<ResumeItem>(
      recent.map(session => ({label: session.title, description: session.id, detail: session.cwd, session})),
      {title: 'Resume a PraeCode conversation', placeHolder: 'Conversations PraeCode recorded for this workspace and profile'}
    );
    if (!pick) return;
    await controller.resume(pick.session.id, pick.session.cwd, pick.session.title);
    this.host.publish();
    this.host.view.post({type: 'showChat'});
  }

  /** Command-palette rename: prefilled so a typo can be corrected in place. */
  async rename(): Promise<void> {
    const controller = this.host.controller;
    const session = controller.active;
    if (!session) throw new Error('Create or select a conversation first');
    const title = await vscode.window.showInputBox({
      title: 'Session name',
      prompt: 'Shown in the conversation picker and used for exports',
      value: session.title,
      valueSelection: [0, session.title.length],
      validateInput: value => {
        const clean = value.replace(/[\r\n]+/g, ' ').trim();
        return !clean ? 'Enter a session name' : clean.length > 120 ? 'Maximum 120 characters' : undefined;
      }
    });
    if (title === undefined) return;
    await controller.rename(session.id, title);
    this.host.publish();
  }

  async compact(): Promise<void> {
    const session = this.host.controller.active;
    if (!session) throw new Error('Create or select a conversation first');
    if (session.busy) throw new Error('Wait for the turn to finish before compacting');
    const focus = await vscode.window.showInputBox({
      title: 'Compact session',
      prompt: 'Optional: what should the summary keep? (blank summarises everything older)',
      placeHolder: 'e.g. the effort-ladder bug'
    });
    if (focus === undefined) return;
    const result = await this.host.controller.compact(session.id, focus.trim());
    this.host.view.post({type: 'compacted', id: session.id, ...result, focus: focus.trim()});
    if (result.warning) void vscode.window.showWarningMessage(result.warning);
    this.host.publish();
  }

  /** Command-palette selection attach; the composer's context row is the primary path. */
  async attachSelection(): Promise<void> {
    this.host.trusted();
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) throw new Error('Select code in an editor first.');
    const text = editor.document.getText(editor.selection);
    if (text.length > 100_000) throw new Error('Selection is too large (maximum 100000 characters).');
    const filename = vscode.workspace.asRelativePath(editor.document.uri);
    await this.host.view.open();
    await this.awaitViewReady();
    this.host.view.post({
      type: 'draft',
      text: `Selected context: ${filename}:${editor.selection.start.line + 1}-${editor.selection.end.line + 1}\n\n${text}`
    });
  }

  /** A webview that was just created reports readiness asynchronously; never lose a draft to that. */
  async awaitViewReady(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.host.view.isReady && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    if (!this.host.view.isReady) throw new Error('Chat view did not become ready; try again.');
  }

  /**
   * Send a turn. The webview clears the composer optimistically, so a failure has to hand the draft
   * back — otherwise a rejected message disappears without trace.
   */
  async send(message: Record<string, any>, id: string): Promise<void> {
    if (typeof message.text !== 'string') throw new Error('Invalid message');
    try {
      const {attachments, contents} = await readAttachments(message.attachments ?? []);
      const images = readImages(message.images);
      await this.host.controller.send(id, message.text, attachments, contents, images);
    } catch (error) {
      this.host.report(error, message.text);
      return;
    }
    this.host.view.post({type: 'sent', text: message.text});
  }

  /** "Use result" on a worker: put its output in the main composer for review. */
  async useWorkerResult(id: string): Promise<void> {
    const controller = this.host.controller;
    const result = controller.result(id);
    if (!result) throw new Error('No completed assistant output to use yet');
    if (controller.get(id).busy) throw new Error('Wait for this worker to finish');
    let main = controller.sessions.find(session => session.kind === 'chat' && !session.busy && session.status !== 'disconnected');
    if (!main) main = await controller.create();
    controller.select(main.id);
    this.host.view.post({type: 'draft', text: `Worker result (review before sending):\n${result.slice(-100_000)}`});
  }

  /** Restore the index from Hermes' catalog, then attach the last conversation. */
  async restore(): Promise<void> {
    const host = this.host;
    if (this.restored || !vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.length) return;
    if (this.restoring) return this.restoring;
    this.restoring = (async () => {
      const controller = host.controller;
      let discovered: {id: string; cwd: string; title: string; profile: string}[] = [];
      try {
        discovered = (await controller.listSaved()).map(session => ({
          id: session.id,
          cwd: session.cwd,
          title: session.title || 'Saved conversation',
          profile: host.profile
        }));
      } catch (error) {
        host.output.appendLine(`Session catalog unavailable; keeping saved history: ${String(error)}`);
      }
      const combined = await host.recent.recover(discovered);
      const candidates = combined.filter(entry => entry.profile === host.profile && entry.cwd === host.cwd());
      const last = host.recent.activeId();
      const active = candidates.find(entry => entry.id === last)
        ?? candidates.find(entry => entry.id === discovered[0]?.id)
        ?? candidates.at(-1);
      this.restored = true;
      if (active && !controller.activeId) {
        try {
          await controller.resume(active.id, active.cwd, active.title);
        } catch (error) {
          host.view.post({
            type: 'error',
            message: `Saved conversation could not be resumed. Its history has been kept: ${String(error)}`
          });
        }
      }
      host.publish();
    })().finally(() => {
      this.restoring = undefined;
    });
    return this.restoring;
  }
}
