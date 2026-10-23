import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PresetRepository} from '../src/domain/PresetRepository';

test('worker presets validate, persist, update and remove without touching Hermes config', async () => {
 const data:Record<string,unknown>={};
 const repo=new PresetRepository({get:(k,d)=>data[k]??d,update:async(k,v)=>{data[k]=v;}});
 const p=await repo.save({name:'Reviewer',provider:'openai-codex',model:'gpt-5.4',effort:'high',instructions:'Review, do not modify files.'});
 assert.equal(repo.list()[0].name,'Reviewer');
 await repo.save({...p,name:'Reader'}); assert.equal(repo.list().length,1);
 assert.equal(repo.list()[0].name,'Reader');
 await assert.rejects(()=>repo.save({...p,name:''}),/name/i);
 await assert.rejects(()=>repo.save({...p,effort:'invented'}),/effort/i);
 await repo.remove(p.id); assert.equal(repo.list().length,0);
});
