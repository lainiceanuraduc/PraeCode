import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {SessionController} from '../src/application/SessionController';
import type {SessionControl} from '../src/infrastructure/HermesControl';

class Agent extends EventEmitter {
 readonly acceptsImages=true;
 loadFails=false;
 async connect(){return {};}
 async newSession(){return {sessionId:'s1'};}
 async loadSession(){if(this.loadFails)throw new Error('session/load refused by agent');return {};}
 async prompt(){return {stopReason:'end_turn'};}
 cancel(){}
 async setMode(){return {};}
 async setModel(){return {};}
 dispose(){}
}
const base=(over:Partial<SessionControl>={}):SessionControl=>({
 inspect:async()=>({model:'m',provider:'p',baseUrl:'',effort:'low',wireEffort:'low',approvalPolicy:'ask',
  capabilities:{values:['none','low','high'],note:''}}),
 setEffort:async()=>({model:'m',provider:'p',baseUrl:'',effort:'low',wireEffort:'low',approvalPolicy:'ask',
  capabilities:{values:[],note:''}}),
 catalog:async()=>({values:[],note:''}),
 capabilities:async()=>({values:[],note:''}),
 compact:async(id:string)=>({sessionId:id,compressed:true,messages:3}),
 rename:async(id:string,title:string)=>({sessionId:id,title}),
 modelInfo:async()=>({provider:'p',providerLabel:'P',model:'m',baseUrl:'',lab:'',context:null,
  contextSource:'',catalogName:'',capabilities:{values:[],note:''}}),
 sessions:async()=>[],
 subagents:async()=>({running:[],recent:[]}),
 mistralModels:async()=>({count:0,models:[]}),
 mistralDiscover:async(model:string)=>({model,levels:null,note:'',source:'unavailable'}),
 saveProvider:async(d)=>({id:d.id,label:d.label||d.id,baseUrl:d.baseUrl,defaultModel:d.defaultModel,
  hasKey:!!d.apiKey,models:[]}),
 testProvider:async()=>({ok:true,models:[],count:0}),

 ...over,
});

test('a rename is a database edit: it works for a session that never loaded in this window',async()=>{
 const calls:string[]=[];
 const controller=new SessionController(new Agent(),base({rename:async(id,title)=>{calls.push(id);return {sessionId:id,title};}}),
  ()=>process.cwd(),()=>2);
 const renamed:{id:string;title:string}[]=[];
 controller.recent=(id,title)=>renamed.push({id,title});
 const title=await controller.renameSaved('saved-42','  Renamed   while stored ');
 assert.equal(title,'Renamed while stored','whitespace is normalised');
 assert.deepEqual(calls,['saved-42'],'the bridge did the rename');
 assert.deepEqual(renamed,[{id:'saved-42',title:'Renamed while stored'}],'the saved index follows');
 await assert.rejects(()=>controller.renameSaved('saved-42','  '),/Enter a session name/);
 controller.dispose();
});

test('a failed replay after a successful compaction is a warning, not a failed compaction',async()=>{
 const client=new Agent();const controller=new SessionController(client,base(),()=>process.cwd(),()=>2);
 const s=await controller.create();
 client.loadFails=true;                       // the replay Hermes owes us after compress fails
 const result=await controller.compact(s.id,'');
 assert.equal(result.nothing,undefined,'a real compaction is not reported as "nothing"');
 assert.match(result.warning??'',/could not be replayed/,'the replay failure is surfaced as a warning');
 assert.equal(s.status,'idle','the session stays usable after the warning');
 controller.dispose();
});

test('nothing to compact is a result, not an error',async()=>{
 const controller=new SessionController(new Agent(),base({compact:async(id:string)=>({sessionId:id,compressed:false})}),
  ()=>process.cwd(),()=>2);
 const s=await controller.create();
 const result=await controller.compact(s.id,'');
 assert.equal(result.nothing,true);
 assert.equal(result.warning,undefined);
 controller.dispose();
});

test('the context window is known before the first turn, occupancy is not invented',async()=>{
 const controller=new SessionController(new Agent(),base({
  modelInfo:async()=>({provider:'p',providerLabel:'P',model:'m',baseUrl:'',lab:'',context:200000,
   contextSource:'catalog',catalogName:'M',capabilities:{values:[],note:''}}),
 }),()=>process.cwd(),()=>2);
 const s=await controller.create();
 await controller.refreshLadder(s.id);
 assert.equal(s.info?.context?.limit,200000,'the catalog window is used as the denominator');
 assert.equal(s.info?.context?.used,null,'occupancy is unknown until Hermes reports it');
 assert.equal(s.info?.context?.source,'catalog');
 // An inspect that omits the window must not erase it.
 await controller.refreshLadder(s.id);
 assert.equal(s.info?.context?.limit,200000);
 controller.dispose();
});

test('a disconnected session can still be renamed and compacted, a busy one cannot',async()=>{
 const client=new Agent();let release:()=>void=()=>undefined;client.prompt=async()=>{await new Promise<void>(r=>{release=r;});return {stopReason:'end_turn'};};
 const controller=new SessionController(client,base(),()=>process.cwd(),()=>2);
 const s=await controller.create();
 const run=controller.send(s.id,'hi');
 await new Promise(r=>setTimeout(r,5));
 await assert.rejects(()=>controller.rename(s.id,'too early'),/current turn/);
 await assert.rejects(()=>controller.compact(s.id,''),/current turn/);
 release();await run;
 s.status='disconnected';                     // e.g. the ACP child exited
 await controller.rename(s.id,'After a crash');
 assert.equal(s.title,'After a crash','rename does not need a live ACP connection');
 await controller.compact(s.id,'');
 controller.dispose();
});
