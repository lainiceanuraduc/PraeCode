import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clampEffort, EFFORT_LADDER} from '../src/domain/EffortLadder';

test('clampEffort mirrors Hermes: verbatim when supported, else nearest weaker, never "none" for an enabled ask', () => {
 assert.deepEqual(EFFORT_LADDER, ['none','minimal','low','medium','high','xhigh','max']);
 assert.equal(clampEffort('none',['none','high']),'none');
 assert.equal(clampEffort('medium',['none','high']),'high');      // Mistral native
 assert.equal(clampEffort('low',['none','high']),'high');
 assert.equal(clampEffort('max',['none','low','medium','high']),'high'); // Ollama Cloud
 assert.equal(clampEffort('medium',['none','low','medium','high']),'medium');
 assert.equal(clampEffort('default',['none','high']),'default');
 assert.equal(clampEffort('high',[]),'high');                       // unknown capabilities: pass through
});
