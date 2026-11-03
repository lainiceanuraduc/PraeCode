/** The command-palette surface, in one table, behind one error boundary. */
import * as vscode from 'vscode';
import type {ExtensionHost} from '../host';
import type {SessionCommands} from './SessionCommands';
import type {ModelCommands} from './ModelCommands';
import type {WorkspaceCommands} from './WorkspaceCommands';

export interface CommandTargets {
  sessions: SessionCommands;
  models: ModelCommands;
  workspace: WorkspaceCommands;
}

/**
 * Every command goes through the same boundary, so a failure always reaches the user visibly instead
 * of becoming an unhandled rejection in a menu action.
 */
export function registerCommands(host: ExtensionHost, targets: CommandTargets): vscode.Disposable[] {
  const commands: Record<string, () => unknown> = {
    'radcode.open': () => host.view.open(),
    'radcode.newSession': () => targets.sessions.newSession(),
    'radcode.renameSession': () => targets.sessions.rename(),
    'radcode.compact': () => targets.sessions.compact(),
    'radcode.screenshot': () => targets.workspace.screenshot(),
    'radcode.mcp': () => targets.workspace.openMcp(),
    'radcode.attachSelection': () => targets.sessions.attachSelection(),
    'radcode.model': () => targets.models.openPicker(),
    'radcode.settings': () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:lainiceanuraduc.praecode'),
    'radcode.logs': () => host.output.show(true),
    'radcode.reviewChanges': () => host.changes.pick()
  };
  return Object.entries(commands).map(([name, handler]) => vscode.commands.registerCommand(name, async () => {
    try {
      return await handler();
    } catch (error) {
      host.report(error);
      throw error;
    }
  }));
}
