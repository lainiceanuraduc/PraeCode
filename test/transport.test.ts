import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { JsonRpcTransport } from '../src/infrastructure/JsonRpcTransport';

test('JSON-RPC correlates fragmented responses, notifications, and server permission requests', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const transport = new JsonRpcTransport(input, output, 100);
  const sent: any[] = []; output.on('data', b => sent.push(JSON.parse(String(b))));
  const updates: any[] = []; transport.on('notification', n => updates.push(n));
  transport.handleRequest = async (_method, params) => ({ outcome: { outcome: 'selected', optionId: params.options[0].optionId } });
  const pending = transport.request('initialize', { protocolVersion: 1 });
  input.write('{"jsonrpc":"2.0","id":1,"res'); input.write('ult":{"protocolVersion":1}}\n');
  assert.deepEqual(await pending, { protocolVersion: 1 });
  input.write(JSON.stringify({ jsonrpc:'2.0', method:'session/update', params:{ sessionId:'s' } })+'\n');
  input.write(JSON.stringify({ jsonrpc:'2.0', id:'ask', method:'session/request_permission', params:{ options:[{optionId:'deny'}] } })+'\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates[0].method, 'session/update');
  assert.equal(sent[1].result.outcome.optionId, 'deny');
  transport.dispose();
});
