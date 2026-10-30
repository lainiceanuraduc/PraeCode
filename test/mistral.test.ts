import {test} from 'node:test';
import assert from 'node:assert/strict';
import {capabilityChips,modelBlockedReason} from '../src/domain/ModelCatalog';
import type {MistralModelFacts} from '../src/domain/ModelCatalog';

const base:MistralModelFacts={id:'mistral-large-4',name:'mistral-large-4',description:'Mistral Large 4.0',
 lab:'mistralai',context:1048576,aliases:['mistral-large-4-0'],
 capabilities:{reasoning:true,vision:true,function_calling:true,completion_fim:false},
 labsGated:false,efforts:['low','medium','high'],effortsSource:'discovered'};

test('capability chips claim only what the provider advertises',()=>{
 assert.deepEqual(capabilityChips(base),['reasoning','vision']);
 assert.deepEqual(capabilityChips({...base,capabilities:{reasoning:false,vision:false,function_calling:true,completion_fim:true}}),['FIM']);
 assert.deepEqual(capabilityChips(undefined),[],'no facts means no claims');
});
test('a Labs model is blocked with the reason the API actually returns',()=>{
 assert.equal(modelBlockedReason(base),'');
 const labs={...base,id:'labs-leanstral-1-5',labsGated:true};
 assert.match(modelBlockedReason(labs),/403/);
 assert.deepEqual(capabilityChips(labs).at(-1),'Labs: needs org access');
});
