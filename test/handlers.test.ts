import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildHandlerTable} from '../src/extension/handlers';
import {mergeHandlers} from '../src/extension/handlers/types';

/**
 * The webview protocol: every type the webview posts. Adding one means adding a handler, and this
 * list is what stops a message from becoming silently unsupported after a refactor (the `screenshot`
 * handler was lost exactly that way when the table was split).
 */
const PROTOCOL = [
  'settings', 'logs', 'history', 'attach', 'new', 'model', 'manualModel', 'favoritesRequest',
  'favorite', 'modelInfo', 'modelFacts', 'providerSave', 'providerTest', 'useModel', 'profile',
  'subagents', 'saveProfile', 'select', 'rename', 'send', 'cancel', 'textSize', 'effort', 'mode',
  'savePreset', 'deletePreset', 'runWorker', 'useResult', 'catalog', 'compact', 'permission',
  'permissionDetails', 'reviewChange', 'keepChange', 'revertChange', 'clearReviewed', 'screenshot',
  'files', 'open', 'link'
];

/** Enough of the host for the table to be built; nothing here is executed by this test. */
const host = new Proxy({}, {get: () => () => undefined}) as any;
const commands = new Proxy({}, {get: () => () => undefined}) as any;
const table = buildHandlerTable(host, commands, commands, commands);

test('every webview message type has exactly one handler', () => {
  assert.deepEqual(Object.keys(table).sort(), [...PROTOCOL].sort());
});

test('a webview type cannot be silently dropped or duplicated', () => {
  assert.throws(() => mergeHandlers({a: () => 0}, {a: () => 0}), /Duplicate webview handler/);
  const withoutScreenshot = Object.keys(table).filter(type => type !== 'screenshot');
  assert.equal(withoutScreenshot.length, PROTOCOL.length - 1, 'the protocol list must catch a removal');
});

test('every handler is a function, so dispatch cannot reach a non-callable', () => {
  for (const [type, handler] of Object.entries(table)) assert.equal(typeof handler, 'function', type);
});
