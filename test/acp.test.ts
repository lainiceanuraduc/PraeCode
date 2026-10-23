import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AcpClient} from '../src/infrastructure/AcpClient';

test('ACP launches without a shell, negotiates, streams, cancels, and rejects unsupported client calls', async () => {
 const client = new AcpClient({executable:process.execPath, args:['test/fixtures/agent.cjs'], cwd:process.cwd()});
 const events:any[]=[]; client.on('update', p=>events.push(p));
 try {
  const init=await client.connect(); assert.equal(init.protocolVersion,1);
  const s=await client.newSession(process.cwd()); assert.equal(s.sessionId,'test-session');
  assert.equal((await client.prompt(s.sessionId,'hi')).stopReason,'end_turn');
  assert.equal(events[0].update.content.text,'hello');
  await client.setModel(s.sessionId,'test-model');
  client.cancel(s.sessionId);
 } finally {client.dispose();}
});
