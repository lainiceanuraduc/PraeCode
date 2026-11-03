/**
 * The webview message table, assembled from one module per domain.
 *
 * A table rather than a switch: adding a message means adding one line, and every type a compromised
 * webview could reach is enumerable in one place (and refused if two modules claim it).
 */
import type {ExtensionHost} from '../host';
import type {SessionCommands} from '../commands/SessionCommands';
import type {ModelCommands} from '../commands/ModelCommands';
import type {WorkspaceCommands} from '../commands/WorkspaceCommands';
import {changeHandlers} from './changes';
import {conversationHandlers} from './conversation';
import {modelHandlers} from './models';
import {panelHandlers} from './panels';
import {mergeHandlers, type HandlerTable} from './types';

export function buildHandlerTable(
  host: ExtensionHost,
  sessions: SessionCommands,
  models: ModelCommands,
  workspace: WorkspaceCommands
): HandlerTable {
  return mergeHandlers(
    conversationHandlers(host, sessions, workspace),
    modelHandlers(host, models),
    panelHandlers(host, workspace),
    changeHandlers(host)
  );
}

export type {HandlerTable, MessageHandler} from './types';
