import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupModels, providerOf, toggleFavorite} from '../src/domain/ModelCatalog';

test('ACP model ids keep their whole provider, including named endpoints and colon-bearing models',()=>{
 assert.deepEqual(providerOf('ollama-cloud:deepseek-v4.1-flash:1017'),{provider:'ollama-cloud',model:'deepseek-v4.1-flash:1017'});
 assert.deepEqual(providerOf('custom:ollama:llama3.2'),{provider:'custom:ollama',model:'llama3.2'});
 assert.deepEqual(providerOf('openrouter:anthropic/claude-sonnet-4.5'),
  {provider:'openrouter',model:'anthropic/claude-sonnet-4.5'});
 assert.deepEqual(providerOf('bare-model'),{provider:'',model:'bare-model'});
});

test('models group by provider in first-seen order, labelled from the ACP description',()=>{
 const groups=groupModels([
  {modelId:'mistral:mistral-large-4',name:'Mistral · mistral-large-4',description:'Provider: Mistral'},
  {modelId:'ollama-cloud:qwen3:32b',name:'Ollama Cloud · qwen3:32b',description:'Provider: Ollama Cloud'},
  {modelId:'mistral:codestral',name:'Mistral · codestral',description:'Provider: Mistral'},
 ]);
 assert.deepEqual(groups.map(g=>g.slug),['mistral','ollama-cloud']);
 assert.equal(groups[0].label,'Mistral');
 assert.deepEqual(groups[0].models.map(m=>m.id),['mistral:mistral-large-4','mistral:codestral']);
 assert.equal(groups[0].models[1].label,'codestral','the row shows the model, not the provider prefix');
 assert.equal(groups[1].models[0].label,'qwen3:32b');
 assert.equal(groups[1].models[0].provider,'ollama-cloud');
});

test('a favorite is added once and removed by starring it again',()=>{
 assert.deepEqual(toggleFavorite([],'mistral:codestral'),['mistral:codestral']);
 assert.deepEqual(toggleFavorite(['a'],'b'),['a','b']);
 assert.deepEqual(toggleFavorite(['a','b'],'a'),['b']);
 assert.deepEqual(toggleFavorite(['a','a'],'b'),['a','b'],'duplicates collapse');
});
