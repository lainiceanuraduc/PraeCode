import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,mkdirSync,symlinkSync,linkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ChangeJournal} from '../src/infrastructure/ChangeJournal';

function fixture(){
 const root=mkdtempSync(path.join(os.tmpdir(),'praecode-review-'));
 const cwd=path.join(root,'project');mkdirSync(cwd);
 const file=path.join(cwd,'code.ts');const storage=path.join(root,'review.json');
 const journal=new ChangeJournal(storage);
 const observe=(id:string,before:string|null,after:string,status='in_progress')=>journal.observe('profile','session',cwd,
  {sessionUpdate:'tool_call',toolCallId:id,status,kind:'edit',content:[{type:'diff',path:file,oldText:before,newText:after}]},true);
 const finish=(id:string,status='completed')=>journal.observe('profile','session',cwd,
  {sessionUpdate:'tool_call_update',toolCallId:id,status},true);
 return {root,cwd,file,storage,journal,observe,finish,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}

test('later user edits block rollback without modifying disk',()=>{
 const f=fixture();try{
  writeFileSync(f.file,'before');f.observe('x','before','agent');writeFileSync(f.file,'agent');f.finish('x');
  writeFileSync(f.file,'user');assert.throws(()=>f.journal.revert(f.journal.list('profile')[0].id,'profile',[f.cwd]),/File changed/);
  assert.equal(readFileSync(f.file,'utf8'),'user');
 }finally{f.cleanup();}
});
test('new files can be reverted and sequential edits must be reverted newest first',()=>{
 const f=fixture();try{
  f.observe('new',null,'one');writeFileSync(f.file,'one');f.finish('new');
  const first=f.journal.list('profile')[0].id;
  f.observe('next','one','two');writeFileSync(f.file,'two');f.finish('next');
  assert.throws(()=>f.journal.revert(first,'profile',[f.cwd]),/File changed/);
  f.journal.revert(f.journal.list('profile')[0].id,'profile',[f.cwd]);
  assert.equal(readFileSync(f.file,'utf8'),'one');f.journal.revert(first,'profile',[f.cwd]);assert.equal(existsSync(f.file),false);
 }finally{f.cleanup();}
});
test('failed, interrupted, replayed and ambiguous patches never become revertible',()=>{
 const f=fixture();try{
  writeFileSync(f.file,'before');f.observe('failed','before','after');f.finish('failed','failed');
  f.observe('interrupted','before','after');
  const loaded=new ChangeJournal(f.storage);assert.ok(loaded.list('profile').every(r=>r.state==='unavailable'));
  f.observe('v4a',null,'*** Begin Patch\n*** Add File: code.ts');
  assert.equal(f.journal.list('profile')[0].canReview,false);
  f.journal.observe('profile','session',f.cwd,{sessionUpdate:'tool_call',toolCallId:'replay',status:'completed',content:[{type:'diff',path:f.file,oldText:'before',newText:'after'}]},false);
  assert.equal(f.journal.list('profile').length,3);
  f.journal.settleSession('profile','session');assert.ok(f.journal.list('profile').every(r=>r.state==='unavailable'));
 }finally{f.cleanup();}
});
test('actual gateway location-only starts record before/after and support deletion rollback',()=>{
 const f=fixture();try{
  writeFileSync(f.file,'original');
  f.journal.observe('profile','session',f.cwd,{sessionUpdate:'tool_call',toolCallId:'gateway',kind:'edit',locations:[{path:f.file}]},true);
  writeFileSync(f.file,'edited');f.finish('gateway');
  let r=f.journal.list('profile')[0];assert.equal(r.state,'ready');
  assert.equal(f.journal.get(r.id,'profile').before,'original');
  assert.equal(f.journal.get(r.id,'profile').after,'edited');
  f.journal.revert(r.id,'profile',[f.cwd]);assert.equal(readFileSync(f.file,'utf8'),'original');
  f.journal.observe('profile','session',f.cwd,{sessionUpdate:'tool_call',toolCallId:'delete',kind:'edit',locations:[{path:f.file}]},true);
  rmSync(f.file);f.finish('delete');r=f.journal.list('profile')[0];assert.equal(r.state,'ready');
  f.journal.revert(r.id,'profile',[f.cwd]);assert.equal(readFileSync(f.file,'utf8'),'original');
 }finally{f.cleanup();}
});
test('overlapping tool writes to the same file cannot be reverted automatically',()=>{
 const f=fixture();try{
  writeFileSync(f.file,'before');f.observe('a','before','one');f.observe('b','before','two');
  writeFileSync(f.file,'two');f.finish('a');f.finish('b');
  assert.ok(f.journal.list('profile').every(r=>r.state==='unavailable'));
 }finally{f.cleanup();}
});
test('gateway replacement fragments reconstruct complete snapshots from the pre-edit file',()=>{
 const f=fixture();try{
  writeFileSync(f.file,'header\nbefore\nfooter\n');f.observe('fragment','before','after');
  writeFileSync(f.file,'header\nafter\nfooter\n');f.finish('fragment');
  const r=f.journal.list('profile')[0];assert.equal(r.state,'ready');
  assert.equal(f.journal.get(r.id,'profile').before,'header\nbefore\nfooter\n');
  f.journal.revert(r.id,'profile',[f.cwd]);assert.equal(readFileSync(f.file,'utf8'),'header\nbefore\nfooter\n');
 }finally{f.cleanup();}
});
test('gateway write previews capture an existing full file before overwrite',()=>{
 const f=fixture();try{
  writeFileSync(f.file,'existing');f.observe('write',null,'replacement');writeFileSync(f.file,'replacement');f.finish('write');
  const r=f.journal.list('profile')[0];assert.equal(r.state,'ready');
  f.journal.revert(r.id,'profile',[f.cwd]);assert.equal(readFileSync(f.file,'utf8'),'existing');
 }finally{f.cleanup();}
});
test('partial or late before-images are review-only; completion text never replaces snapshots',()=>{
 const f=fixture();try{
  writeFileSync(f.file,'full before');f.observe('fragment','missing fragment','after');
  assert.equal(f.journal.list('profile')[0].state,'unavailable');
  f.observe('full','full before','full after');writeFileSync(f.file,'full after');
  f.journal.observe('profile','session',f.cwd,{sessionUpdate:'tool_call_update',toolCallId:'full',status:'completed',content:[{type:'content',content:{type:'text',text:'done'}}]},true);
  const r=f.journal.list('profile')[0];assert.equal(r.state,'ready');assert.equal(f.journal.get(r.id,'profile').after,'full after');
  assert.throws(()=>f.journal.get(r.id,'other'),/not found/);
 }finally{f.cleanup();}
});
test('outside workspace, symlinks and sensitive targets are neither read nor revertible',()=>{
 const f=fixture();try{
  const outside=path.join(f.root,'outside');writeFileSync(outside,'private');symlinkSync(outside,f.file);
  for(const file of [f.file,outside,path.join(f.cwd,'.env')]){
   f.journal.observe('profile','session',f.cwd,{sessionUpdate:'tool_call',toolCallId:file,kind:'edit',content:[{type:'diff',path:file,oldText:'private',newText:'new'}]},true);
  }
  assert.ok(f.journal.list('profile').every(r=>!r.canReview&&r.state==='unavailable'));
  assert.equal(readFileSync(outside,'utf8'),'private');
 }finally{f.cleanup();}
});
test('keeping is metadata only, clear removes only reviewed entries, pending is not kept',()=>{
 const f=fixture();try{
  writeFileSync(f.file,'before');f.observe('x','before','after');
  assert.throws(()=>f.journal.keep(f.journal.list('profile')[0].id,'profile'),/Wait/);
  writeFileSync(f.file,'after');f.finish('x');f.journal.keep(f.journal.list('profile')[0].id,'profile');
  assert.equal(readFileSync(f.file,'utf8'),'after');f.observe('y','after','next');
  f.journal.clearReviewed('profile');assert.equal(f.journal.list('profile').length,1);
  assert.equal(f.journal.list('profile')[0].state,'pending');
 }finally{f.cleanup();}
});
test('record cap warns without silently discarding pending reviews',()=>{
 const f=fixture();try{
  writeFileSync(f.file,'before');for(let n=0;n<101;n++)f.observe(String(n),'before','after');
  assert.equal(f.journal.list('profile').length,100);assert.match(f.journal.notice,/limit reached/);
 }finally{f.cleanup();}
});

test('completed edits are remembered separately from transcript and safely reverted',()=>{
 const f=fixture();try{
  writeFileSync(f.file,'original\n');f.observe('edit','original\n','changed\n');
  writeFileSync(f.file,'changed\n');f.finish('edit');
  const record=f.journal.list('profile')[0];assert.equal(record.state,'ready');
  const loaded=new ChangeJournal(f.storage);assert.equal(loaded.list('profile').length,1);
  assert.equal(loaded.list('another-profile').length,0);
  loaded.revert(record.id,'profile',[f.cwd]);assert.equal(readFileSync(f.file,'utf8'),'original\n');
  assert.equal(loaded.list('profile')[0].state,'reverted');
 }finally{f.cleanup();}
});

test('revert refuses a symlink, a hardlink and a swap instead of following them',()=>{
 const f=fixture();try{
  const outside=path.join(f.root,'secret.txt');writeFileSync(outside,'outside');
  writeFileSync(f.file,'before');f.observe('x','before','after');writeFileSync(f.file,'after');f.finish('x');
  const id=f.journal.list('profile')[0].id;
  // Replace the recorded file with a symlink to something outside the workspace.
  rmSync(f.file);symlinkSync(outside,f.file);
  assert.throws(()=>f.journal.revert(id,'profile',[f.cwd]),/Symlink|symbolic/i);
  assert.equal(readFileSync(outside,'utf8'),'outside','the symlink target is never written');
 }finally{f.cleanup();}
});
test('revert refuses a hardlinked file so shared bytes cannot be rewritten',()=>{
 const f=fixture();try{
  writeFileSync(f.file,'before');f.observe('h','before','after');writeFileSync(f.file,'after');f.finish('h');
  const id=f.journal.list('profile')[0].id;
  const link=path.join(f.cwd,'other.ts');linkSync(f.file,link);
  assert.throws(()=>f.journal.revert(id,'profile',[f.cwd]),/single-link|hard link/i);
  assert.equal(readFileSync(f.file,'utf8'),'after');
 }finally{f.cleanup();}
});
