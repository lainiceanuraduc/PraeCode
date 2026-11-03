/**
 * Handlers for one webview message type.
 *
 * `id()` resolves the message's session/preset id and refuses a missing one, so no handler has to
 * repeat that check. A handler's return value is ignored; anything it must show goes through `post`.
 */
export type MessageHandler = (message: Record<string, any>, id: () => string) => unknown;
export type HandlerTable = Record<string, MessageHandler>;

/** Merge per-domain tables, refusing a duplicate type: two owners of one message is a bug. */
export function mergeHandlers(...tables: HandlerTable[]): HandlerTable {
  const merged: HandlerTable = {};
  for (const table of tables) {
    for (const [type, handler] of Object.entries(table)) {
      if (merged[type]) throw new Error(`Duplicate webview handler for "${type}"`);
      merged[type] = handler;
    }
  }
  return merged;
}
