/**
 * @module RadCodeExtension
 * Composition root: the only place that knows about *both* VS Code and the Hermes-facing services.
 *
 * This class only wires things together. Commands, webview handlers and the state push each live in
 * their own module under `commands/`, `handlers/` and `state/`, and receive the `ExtensionHost`
 * interface this class implements rather than the class itself.
 */
import * as vscode from 'vscode';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';

import {AcpClient} from '../infrastructure/AcpClient';
import {HermesControl} from '../infrastructure/HermesControl';
import {SessionController} from '../application/SessionController';
import {PresetRepository} from '../domain/PresetRepository';
import {ChatViewProvider} from '../presentation/ChatViewProvider';
import {webviewMessageError} from '../domain/MessageLimits';

import {mcpServers} from './Settings';
import {PermissionBroker} from './PermissionBroker';
import {ChangeReview} from './ChangeReview';

import type {ExtensionHost} from './host';
import {RecentIndex} from '../state/Recents';
import {buildState} from '../state/publish';
import {SessionCommands} from './commands/SessionCommands';
import {ModelCommands} from './commands/ModelCommands';
import {WorkspaceCommands} from './commands/WorkspaceCommands';
import {registerCommands} from './commands/register';
import {buildHandlerTable, type HandlerTable} from './handlers';

export class RadCodeExtension implements vscode.Disposable, ExtensionHost {
  readonly view: ChatViewProvider;
  readonly presets: PresetRepository;
  readonly permissions: PermissionBroker;
  readonly changes: ChangeReview;
  readonly recent: RecentIndex;
  readonly output: vscode.OutputChannel;

  private serviceInstance?: SessionController;
  private readonly disposables: vscode.Disposable[] = [];
  private renderTimer?: NodeJS.Timeout;
  private profileValue = '';
  private handlersTable?: HandlerTable;
  private readonly sessions: SessionCommands;
  private readonly models: ModelCommands;
  private readonly workspace: WorkspaceCommands;

  constructor(readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel('PraeCode Hermes');
    this.presets = new PresetRepository(context.globalState);
    this.view = new ChatViewProvider(context.extensionUri);
    this.permissions = new PermissionBroker(this.view, () => this.serviceInstance?.sessions ?? [],
      text => this.output.appendLine(redact(text)));
    this.changes = new ChangeReview(changeStorePath(context), () => this.profile,
      () => this.serviceInstance?.sessions ?? [], () => this.publish());
    this.profileValue = resolveProfileHome();
    this.recent = new RecentIndex(context.workspaceState, () => this.profile);

    this.sessions = new SessionCommands(this);
    this.models = new ModelCommands(this, this.sessions);
    this.workspace = new WorkspaceCommands(this, this.sessions);
    this.view.onMessage = message => this.handle(message);

    this.disposables.push(
      this.output,
      this.view,
      this.changes,
      vscode.window.registerWebviewViewProvider('radcode.chat', this.view, {webviewOptions: {retainContextWhenHidden: true}}),
      ...registerCommands(this, {sessions: this.sessions, models: this.models, workspace: this.workspace})
    );
    this.watchEnvironment();
    this.publish();
  }

  // ------------------------------------------------------------------ host surface

  get service(): SessionController | undefined {
    return this.serviceInstance;
  }

  get profile(): string {
    return this.profileValue || resolveProfileHome();
  }

  /** Hermes runs tools in a real folder; a single-file or remote window has nothing to run them in. */
  cwd(): string {
    const editor = vscode.window.activeTextEditor;
    const folder = (editor && vscode.workspace.getWorkspaceFolder(editor.document.uri)) || vscode.workspace.workspaceFolders?.[0];
    if (!folder || folder.uri.scheme !== 'file') throw new Error('Open a local project folder before connecting to Hermes.');
    return folder.uri.fsPath;
  }

  trusted(): void {
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before running Hermes tools.');
  }

  /** The profile directory, resolved the same way the runtime resolves it. */
  profileHome(): string {
    const configured = vscode.workspace.getConfiguration('radcode').get<string>('hermesHome', '') || process.env.HERMES_HOME || '';
    return configured || path.join(homedir(), '.hermes');
  }

  publish(): void {
    this.changes.settle();
    this.view.stateChanged(buildState(this));
  }

  async confirm(message: string, label: string): Promise<boolean> {
    return (await vscode.window.showWarningMessage(message, {modal: true}, label)) === label;
  }

  async openSettings(query: string): Promise<unknown> {
    return vscode.commands.executeCommand('workbench.action.openSettings', query);
  }

  /** Surface a failure in both places the user might be looking, with the draft when relevant. */
  report(error: unknown, draft?: string): void {
    const message = error instanceof Error ? error.message : String(error);
    this.view.post({type: 'error', message, draft});
    void vscode.window.showErrorMessage(message);
  }

  /**
   * Lazily build the Hermes connection.
   *
   * Deferred on purpose: the view must render (and settings must apply) before Hermes is even probed,
   * so a missing or broken install shows a readable error instead of failing activation.
   */
  get controller(): SessionController {
    this.trusted();
    if (this.serviceInstance) return this.serviceInstance;
    const config = vscode.workspace.getConfiguration('radcode');
    let executable = config.get<string>('hermesPath', 'hermes');
    const local = path.join(homedir(), '.local', 'bin', 'hermes');
    if (executable === 'hermes' && existsSync(local)) executable = local;
    const home = config.get<string>('hermesHome', '') || process.env.HERMES_HOME || '';
    if (home && !path.isAbsolute(home)) throw new Error('radcode.hermesHome must be an absolute path to an existing profile.');
    this.profileValue = home || path.join(homedir(), '.hermes');

    const client = new AcpClient({executable, cwd: this.cwd(), home});
    client.permission = params => this.permissions.request(params);
    client.on('diagnostic', text => this.output.append(redact(String(text))));
    client.on('update', ({sessionId, update}) => this.changes.observe(sessionId, update));
    const control = new HermesControl(executable, this.context.asAbsolutePath('bridge/control.py'), home,
      config.get<string>('pythonPath') || undefined);
    this.serviceInstance = new SessionController(client, control, () => this.cwd(),
      () => vscode.workspace.getConfiguration('radcode').get<number>('maxParallelAgents', 2));

    // Hooks the controller cannot own: which MCP servers a new session gets, and the recent list.
    this.serviceInstance.mcpServers = () => mcpServers();
    this.serviceInstance.recent = (id, title) => this.recent.rememberTitle(id, title);
    this.serviceInstance.on('changed', () => {
      // Coalesce bursts of session updates into one state push.
      if (!this.renderTimer) this.renderTimer = setTimeout(() => {
        this.renderTimer = undefined;
        this.publish();
      }, 60);
    });
    return this.serviceInstance;
  }

  // ------------------------------------------------------------------ wiring

  /** Editor/file changes drive the context chip, so the view mirrors what the user is looking at. */
  private watchEnvironment(): void {
    const mirror = () => this.publish();
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(mirror),
      vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor === vscode.window.activeTextEditor) this.publish();
      }),
      vscode.workspace.onDidOpenTextDocument(mirror),
      vscode.workspace.onDidCloseTextDocument(mirror));
    this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
      const live = ['radcode.accent', 'radcode.fontSize', 'radcode.lineHeight', 'radcode.compact',
        'radcode.mcpServers', 'radcode.maxParallelAgents'];
      if (live.some(key => event.affectsConfiguration(key))) this.publish();
      if (['radcode.hermesPath', 'radcode.hermesHome', 'radcode.pythonPath'].some(key => event.affectsConfiguration(key))) {
        // These are baked into the spawn environment, so only a reload can apply them.
        void vscode.window.showInformationMessage(
          'Reload the window to use the new Hermes runtime/profile. Existing sessions keep their current connection.',
          'Reload').then(choice => {
          if (choice) void vscode.commands.executeCommand('workbench.action.reloadWindow');
        });
      }
    }));
  }

  private handlers(): HandlerTable {
    return this.handlersTable ??= buildHandlerTable(this, this.sessions, this.models, this.workspace);
  }

  private async handle(message: unknown): Promise<void> {
    if (!message || typeof message !== 'object') return;
    const payload = message as Record<string, any>;
    const invalid = webviewMessageError(payload);
    if (invalid) throw new Error(invalid);
    if (payload.type === 'ready') {
      this.publish();
      await this.sessions.restore();
      return;
    }
    this.trusted();
    const handler = this.handlers()[payload.type];
    if (!handler) throw new Error('Unsupported webview action');
    await handler(payload, () => {
      if (typeof payload.id !== 'string' || !payload.id) throw new Error('Missing session or preset ID');
      return payload.id;
    });
    this.publish();
  }

  dispose(): void {
    this.permissions.settleAll();
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.serviceInstance?.dispose();
    this.disposables.splice(0).forEach(disposable => disposable.dispose());
  }
}

/** Where the review journal lives: per workspace when possible, per profile otherwise. */
function changeStorePath(context: vscode.ExtensionContext): string | undefined {
  const root = context.storageUri?.fsPath ?? context.globalStorageUri?.fsPath;
  return root ? path.join(root, 'changes-v1.json') : undefined;
}

/** `radcode.hermesHome` / `HERMES_HOME` when absolute, else the default profile. */
function resolveProfileHome(): string {
  const configured = vscode.workspace.getConfiguration('radcode').get<string>('hermesHome', '') || process.env.HERMES_HOME || '';
  return configured && path.isAbsolute(configured) ? configured : path.join(homedir(), '.hermes');
}

/** Strip credentials out of anything Hermes prints on stderr before it reaches the log channel. */
export function redact(text: string): string {
  return text
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,}]+/gi, '$1[redacted]');
}
