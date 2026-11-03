/**
 * What a command or handler module is allowed to touch.
 *
 * The composition root builds these objects and owns their lifetime; each module beside it receives
 * this interface instead of the root class, so a command cannot reach into unrelated state and a
 * handler cannot re-wire the controller.
 */
import type * as vscode from 'vscode';
import type {ChatViewProvider} from '../presentation/ChatViewProvider';
import type {SessionController} from '../application/SessionController';
import type {PresetRepository} from '../domain/PresetRepository';
import type {PermissionBroker} from './PermissionBroker';
import type {ChangeReview} from './ChangeReview';
import type {RecentIndex} from '../state/Recents';

export interface ExtensionHost {
  readonly context: vscode.ExtensionContext;
  readonly view: ChatViewProvider;
  readonly output: vscode.OutputChannel;
  readonly presets: PresetRepository;
  readonly permissions: PermissionBroker;
  readonly changes: ChangeReview;
  /** The resume index kept in workspace state. */
  readonly recent: RecentIndex;
  /** Lazily created; throws when the workspace is untrusted or is not a real folder. */
  readonly controller: SessionController;
  /** The controller only if it already exists — for state pushes, which must never connect. */
  readonly service: SessionController | undefined;
  /** The Hermes profile home currently in use. */
  readonly profile: string;

  /** Refuse to run anything outside a trusted workspace. */
  trusted(): void;
  /** The folder Hermes runs tools in. */
  cwd(): string;
  /** Resolve the profile directory without connecting. */
  profileHome(): string;
  /** Push the current state to the webview. */
  publish(): void;
  /** Report a failure to the view and the notification area. */
  report(error: unknown, draft?: string): void;
  /** Modal confirmation; true only when the user picked `label`. */
  confirm(message: string, label: string): Promise<boolean>;
  /** Open the settings UI at a query (command palette style). */
  openSettings(query: string): Promise<unknown>;
}
