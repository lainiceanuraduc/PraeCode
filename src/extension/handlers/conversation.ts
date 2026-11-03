/** Conversation handlers: selection, rename, sending, cancelling, effort/mode and worker presets. */
import type {ExtensionHost} from '../host';
import type {SessionCommands} from '../commands/SessionCommands';
import type {WorkspaceCommands} from '../commands/WorkspaceCommands';
import type {HandlerTable} from './types';

export function conversationHandlers(
  host: ExtensionHost,
  sessions: SessionCommands,
  workspace: WorkspaceCommands
): HandlerTable {
  return {
    new: () => sessions.newSession(),
    history: () => sessions.history(),
    attach: () => sessions.attachSelection(),
    select: async (message, id) => {
      const saved = host.recent.find(id());
      if (saved) await host.controller.resume(saved.id, saved.cwd, saved.title);
      else host.controller.select(id());
      host.view.post({type: 'showChat'});
    },
    rename: async (message, id) => {
      if (typeof message.title !== 'string') throw new Error('Enter a session name');
      // A conversation that is only in the saved index has no live session object, but Hermes can
      // still rename it: the edit lives in the database, not in this window.
      if (!host.service?.sessions.some(session => session.id === id())) return host.controller.renameSaved(id(), message.title);
      return host.controller.rename(id(), message.title);
    },
    send: (message, id) => sessions.send(message, id()),
    cancel: (message, id) => {
      // A cancelled turn leaves its approvals moot; settle them so no card outlives the turn.
      host.permissions.settleSession(id());
      host.controller.cancel(id());
    },
    textSize: message => workspace.persistTextSize(message.value),
    effort: (message, id) => {
      if (typeof message.value !== 'string') throw new Error('Invalid effort');
      return host.controller.setEffort(id(), message.value);
    },
    mode: (message, id) => {
      if (typeof message.value !== 'string') throw new Error('Invalid approval mode');
      return host.controller.setMode(id(), message.value);
    },
    compact: (message, id) => {
      const focus = typeof message.focus === 'string' ? message.focus.slice(0, 500) : '';
      return host.controller.compact(id(), focus)
        .then(result => host.view.post({type: 'compacted', id: id(), ...result, focus}));
    },
    useResult: (message, id) => sessions.useWorkerResult(id()),
    savePreset: async message => {
      await host.presets.save(message.preset ?? {});
      host.view.post({type: 'presetSaved'});
    },
    deletePreset: async (message, id) => {
      const preset = host.presets.list().find(entry => entry.id === id());
      if (!preset) return;
      if (await host.confirm(`Delete worker preset “${preset.name}”?`, 'Delete')) await host.presets.remove(preset.id);
    },
    runWorker: (message, id) => {
      const preset = host.presets.list().find(entry => entry.id === id());
      if (!preset) throw new Error('Preset not found');
      if (typeof message.task !== 'string') throw new Error('Enter a task');
      return host.controller.runWorker(preset, message.task);
    }
  };
}
