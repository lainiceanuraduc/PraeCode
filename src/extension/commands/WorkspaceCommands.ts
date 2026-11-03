/**
 * Workspace and settings commands: MCP servers, the attachment picker's file search, the text-size
 * persistence path, and the screenshot entry point.
 */
import * as vscode from 'vscode';
import path from 'node:path';
import {mcpServers, clampTextSize} from '../Settings';
import {secretFileReason} from '../../domain/Attachments';
import {captureScreenshot} from '../screenshot';
import type {ExtensionHost} from '../host';
import type {SessionCommands} from './SessionCommands';

export class WorkspaceCommands {
  constructor(private readonly host: ExtensionHost, private readonly sessions: SessionCommands) {}

  /** Settings entry point for MCP servers: the array itself lives in `radcode.mcpServers`. */
  async openMcp(): Promise<void> {
    let servers: Record<string, unknown>[];
    try {
      servers = mcpServers();
    } catch (error) {
      throw new Error(`${(error as Error).message} (fix it in radcode.mcpServers)`);
    }
    const summary = servers.length
      ? servers.map(server => `${String(server.name)}${'url' in server ? ' (http)' : ' (stdio)'}`).join(', ')
      : 'none configured';
    const pick = await vscode.window.showQuickPick([
      {label: '$(gear) Edit MCP servers', description: summary, value: 'edit'},
      {label: '$(refresh) Test configured servers', description: 'Validate every entry', value: 'test'},
      {label: '$(new-session) New session with these servers', description: 'Hermes registers their tools per session', value: 'session'}
    ], {title: 'MCP servers'});
    if (!pick) return;
    if (pick.value === 'edit') {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'radcode.mcpServers');
      return;
    }
    if (pick.value === 'test') {
      if (!servers.length) throw new Error('No MCP servers configured');
      void vscode.window.showInformationMessage(
        `${servers.length} MCP server entr${servers.length === 1 ? 'y is' : 'ies are'} valid. Hermes connects to them when a session starts.`);
      return;
    }
    await this.sessions.newSession();
  }

  async screenshot(): Promise<void> {
    return captureScreenshot(this.host.view, () => this.host.trusted());
  }

  /**
   * Bounded workspace search for the attachment picker; a webview cannot list files itself.
   * Credential files are filtered out here and refused again by `Inputs` at send time.
   */
  async listFiles(message: Record<string, any>): Promise<void> {
    const query = typeof message.query === 'string' ? message.query.trim() : '';
    if (query.length > 200) throw new Error('Search is too long');
    const found = query
      ? await vscode.workspace.findFiles('**/*', '**/{node_modules,.git,dist,out,.venv,__pycache__}/**', 60)
      : vscode.workspace.textDocuments.filter(document => document.uri.scheme === 'file').map(document => document.uri);
    const paths = found
      .map(uri => ({path: uri.fsPath, name: vscode.workspace.asRelativePath(uri)}))
      .filter(file => !secretFileReason(file.name))
      .filter(file => !query || file.name.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => a.name.split('/').length - b.name.split('/').length || a.name.localeCompare(b.name))
      .slice(0, 60);
    this.host.view.post({type: 'files', paths, query});
  }

  /**
   * Persist the base font size.
   *
   * The configuration API throws "not a registered configuration" when the running host holds a
   * manifest older than the installed VSIX, so the value is mirrored into globalState too.
   */
  async persistTextSize(value: number): Promise<void> {
    const size = clampTextSize(value);
    await this.host.context.globalState.update('radcode.textSize', size);
    try {
      await vscode.workspace.getConfiguration('radcode').update('fontSize', size, vscode.ConfigurationTarget.Global);
    } catch (error) {
      this.host.output.appendLine(`Text size kept in extension state (settings entry unavailable): ${String(error)}`);
    }
  }

  /** Open an attachment's file, or an http(s) link, from the webview. */
  async openPath(message: Record<string, any>): Promise<void> {
    if (typeof message.path !== 'string' || !path.isAbsolute(message.path)) throw new Error('Attachment path must be absolute and point at a file');
    await vscode.window.showTextDocument(vscode.Uri.file(message.path), {preview: true});
  }

  async openLink(message: Record<string, any>): Promise<void> {
    if (typeof message.url !== 'string') return;
    const url = vscode.Uri.parse(message.url, true);
    if (!['https', 'http'].includes(url.scheme)) throw new Error('Only HTTP(S) links are allowed');
    await vscode.env.openExternal(url);
  }
}
