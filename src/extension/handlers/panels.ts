/** Panel handlers: the profile editor, delegation snapshot, file search, links and logs. */
import {readProfile, saveProfile} from '../ProfileStore';
import type {ExtensionHost} from '../host';
import type {WorkspaceCommands} from '../commands/WorkspaceCommands';
import type {HandlerTable} from './types';

export function panelHandlers(host: ExtensionHost, workspace: WorkspaceCommands): HandlerTable {
  return {
    settings: () => host.openSettings('radcode.settings'),
    logs: () => host.output.show(true),

    profile: async () => {
      const home = host.profileHome();
      host.view.post({type: 'profile', home, files: await readProfile(home)});
    },
    saveProfile: async message => {
      if (typeof message.id !== 'string') throw new Error('Unknown profile file');
      const result = await saveProfile(host.profileHome(), message.id, message.text);
      host.view.post({type: 'profileSaved', id: result.id, savedAt: result.savedAt});
    },

    subagents: async () => {
      try {
        host.view.post({type: 'subagents', ...(await host.controller.delegation())});
      } catch (error) {
        host.view.post({
          type: 'subagents',
          error: String(error instanceof Error ? error.message : error),
          running: [],
          recent: []
        });
      }
    },

    screenshot: () => workspace.screenshot(),
    files: message => workspace.listFiles(message),
    open: message => workspace.openPath(message),
    link: message => workspace.openLink(message)
  };
}
