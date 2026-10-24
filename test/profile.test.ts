import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PROFILE_FILES,profileWriteError,resolveProfilePath} from '../src/domain/HermesProfile';

test('profile writes are allowlisted and can never escape the Hermes profile',()=>{
 const home='/home/me/.hermes';
 assert.equal(resolveProfilePath(home,'soul'),'/home/me/.hermes/SOUL.md');
 assert.equal(resolveProfilePath(home,'user'),'/home/me/.hermes/memories/USER.md');
 assert.equal(resolveProfilePath(home,'memory'),'/home/me/.hermes/memories/MEMORY.md');
 for(const hostile of ['../config.yaml','memories/../../.env','/etc/passwd','' ])
  assert.throws(()=>resolveProfilePath(home,hostile),/Unknown profile file/);
 assert.throws(()=>resolveProfilePath('relative/profile','soul'),/absolute/);
});

test('a profile save is refused past the size cap, and empty content is a legal clear',()=>{
 assert.equal(profileWriteError(''),'');
 assert.equal(profileWriteError('note'),'');
 assert.match(profileWriteError('x'.repeat(256*1024+1)),/limited to/);
 assert.match(profileWriteError(42),/text/);
 assert.deepEqual(PROFILE_FILES.map(f=>f.id),['soul','user','memory']);
});
