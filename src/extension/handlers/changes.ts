/**
 * Approval and change-review handlers.
 *
 * Approvals resolve a pending request by id; the change-review actions operate on the journal the
 * extension owns. Both refuse ids the webview invented, because the webview is not trusted.
 */
import type {ExtensionHost} from '../host';
import type {HandlerTable} from './types';

export function changeHandlers(host: ExtensionHost): HandlerTable {
  return {
    permission: message => {
      if (typeof message.requestId !== 'string' || typeof message.optionId !== 'string')
        throw new Error('Invalid approval response');
      if (!host.permissions.settle(message.requestId, {outcome: 'selected', optionId: message.optionId}))
        throw new Error('That request is no longer open; it may have been answered elsewhere');
    },
    permissionDetails: message => {
      if (typeof message.requestId !== 'string') throw new Error('Invalid request id');
      return host.permissions.details(message.requestId);
    },
    reviewChange: message => host.changes.open(String(message.changeId ?? '')),
    keepChange: message => host.changes.keep(String(message.changeId ?? '')),
    revertChange: message => host.changes.revert(String(message.changeId ?? '')),
    clearReviewed: () => host.changes.clear()
  };
}
