import {HermesControl} from '../src/infrastructure/HermesControl';
import {delegationHeadline,policyChips} from '../src/domain/Delegation';
import {homedir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

async function main(){
 const control=new HermesControl(path.join(homedir(),'.local/bin/hermes'),path.resolve('bridge/control.py'));
 const cwd=process.argv[2]||process.cwd();
 const snapshot=await control.subagents(cwd);
 assert.ok(snapshot.policy,'Expected a delegation policy block');
 assert.ok(Array.isArray(snapshot.running)&&Array.isArray(snapshot.recent));
 for(const run of [...snapshot.running,...snapshot.recent]){
  assert.ok(run.id&&run.title,'Every run has an id and a title');
  assert.ok(!JSON.stringify(run).includes('api_key'),'No credentials may leak into a run row');
 }
 console.log(`Policy: ${policyChips(snapshot.policy).map(c=>`${c.label}=${c.value}`).join(', ')}`);
 console.log(delegationHeadline(snapshot));
 for(const run of [...snapshot.running,...snapshot.recent].slice(0,5))
  console.log(`- ${run.title} | ${run.model} | ${run.messages} msgs / ${run.tools} tools | from "${run.parentTitle}" | ${run.endedAt?'done':'(null) '+(run.endReason||'running')}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
