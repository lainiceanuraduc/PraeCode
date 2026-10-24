import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeRecent} from '../src/domain/RecentSessions';

test('startup with no live sessions preserves all saved profiles and more than 30 sessions',()=>{
 const previous=Array.from({length:45},(_,n)=>({id:`s${n}`,title:`Chat ${n}`,cwd:'/project',profile:n%2?'a':'b'}));
 assert.deepEqual(mergeRecent(previous,[]),previous);
});
test('catalog recovery merges by profile and id without deleting other conversations',()=>{
 const row={id:'one',title:'Old',cwd:'/project',profile:'a'};
 const other={...row,profile:'b'};
 const merged=mergeRecent([row,other],[{...row,title:'Renamed'},{...row,id:'recovered'}]);
 assert.equal(merged.length,3);
 assert.equal(merged.find(s=>s.id==='one'&&s.profile==='a')?.title,'Renamed');
 assert.equal(merged.find(s=>s.profile==='b')?.title,'Old');
});
