import {test} from 'node:test';
import assert from 'node:assert/strict';
import {describeProvider,normalizeProviderId,providerDraftErrors} from '../src/domain/ProviderDraft';
import type {ProviderDraft} from '../src/domain/ProviderDraft';

const draft=(over:Partial<ProviderDraft>={}):ProviderDraft=>({
 id:'ollama-local',label:'Ollama Local',baseUrl:'http://localhost:11434/v1',apiKey:'',defaultModel:'lfm3:latest',...over});

test('a local Ollama provider is valid with no API key',()=>{
 assert.deepEqual(providerDraftErrors(draft()),[]);
});
test('the id must be lowercase and must not reuse a Hermes name',()=>{
 assert.match(providerDraftErrors(draft({id:'Ollama Local'}))[0].message,/lowercase/);
 assert.match(providerDraftErrors(draft({id:''}))[0].message,/Enter a provider id/);
 assert.match(providerDraftErrors(draft({id:'custom'}))[0].message,/reserved/);
 assert.deepEqual(providerDraftErrors(draft({id:'my.ollama_2'})),[]);
});
test('the base URL must be a full http(s) API root, not a route',()=>{
 assert.match(providerDraftErrors(draft({baseUrl:'localhost:11434'}))[0].message,/http:\/\//);
 assert.match(providerDraftErrors(draft({baseUrl:'ftp://example.com/v1'}))[0].message,/http:\/\//);
 assert.match(providerDraftErrors(draft({baseUrl:'http://localhost:11434/v1/chat/completions'}))[0].message,/API root/);
 assert.deepEqual(providerDraftErrors(draft({baseUrl:'https://api.example.com/v1'})),[]);
});
test('the id is normalised the way Hermes stores it',()=>{
 assert.equal(normalizeProviderId('  Ollama-Local '),'ollama-local');
});
test('the saved summary never mentions the key itself',()=>{
 const line=describeProvider({id:'ollama-local',label:'Ollama Local',baseUrl:'http://localhost:11434/v1',
  defaultModel:'lfm3:latest',hasKey:true,models:['lfm3:latest','smollm2:360m']});
 assert.match(line,/Ollama Local → http:\/\/localhost:11434\/v1/);
 assert.match(line,/key stored/);
 assert.match(line,/2 models/);
 assert.doesNotMatch(line,/sk-|secret|Bearer/);
});
