import {test} from 'node:test';
import assert from 'node:assert/strict';
import {delegationHeadline,describeAge,describeDuration,policyChips,runState} from '../src/domain/Delegation';
import type {DelegationRun} from '../src/domain/Delegation';

const base:DelegationRun={id:'a',title:'Subagent: fix it',parentTitle:'RadCode',model:'gpt-6-astra',
 messages:62,tools:34,startedAt:1000,lastActivityAt:1200,endedAt:null,endReason:''};

test('a child run is live only while Hermes has not stamped ended_at',()=>{
 assert.equal(runState(base),'running');
 assert.equal(runState({...base,endedAt:1300,endReason:'agent_close'}),'done');
 assert.equal(runState({...base,endedAt:1300,endReason:'cancelled_by_user'}),'cancelled');
 assert.equal(runState({...base,endedAt:1300,endReason:'child_timeout'}),'failed');
});
test('durations read as minutes then hours, never as raw seconds past a minute',()=>{
 assert.equal(describeDuration(38),'38s');
 assert.equal(describeDuration(252),'4m 12s');
 assert.equal(describeDuration(180),'3m');
 assert.equal(describeDuration(7500),'2h 05m');
 assert.equal(describeDuration(7200),'2h');
});
test('ages are relative and tolerate a clock that is slightly behind',()=>{
 assert.equal(describeAge(2000,1999),'just now');
 assert.equal(describeAge(2000,1960),'40s ago');
 assert.equal(describeAge(2000,1820),'3m ago');
 assert.equal(describeAge(2000,2000-7200),'2h ago');
 assert.equal(describeAge(2000,2000-90000),'1d ago');
});
test('policy chips quote Hermes and never invent a default',()=>{
 assert.deepEqual(policyChips(undefined),[]);
 const chips=policyChips({backend:'default',model:'',provider:'',maxConcurrent:10,maxDepth:1,
  childTimeoutSeconds:0,orchestrator:true,oneshotMaxChildren:2});
 const byLabel=Object.fromEntries(chips.map(c=>[c.label,c.value]));
 assert.equal(byLabel['Concurrent children'],'10');
 assert.equal(byLabel['Spawn depth'],'1');
 assert.equal(byLabel['Child timeout'],'none');
 assert.equal(byLabel['Orchestrator'],'on');
 assert.equal(byLabel['Child model'],'profile default','an unset model is the profile default, not blank');
});
test('the headline names what is live, then the standing allowance',()=>{
 assert.equal(delegationHeadline(undefined),'Delegation status unavailable');
 assert.match(delegationHeadline({running:[],recent:[]}),/No child run is active/);
 assert.match(delegationHeadline({running:[base],recent:[],policy:{backend:'default',model:'',provider:'',
  maxConcurrent:10,maxDepth:1,childTimeoutSeconds:0,orchestrator:true,oneshotMaxChildren:2}}),/1 child run active now · Hermes allows 10 at once/);
});
