import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {SessionController} from '../src/application/SessionController';
import {SessionControl} from '../src/infrastructure/HermesControl';

class AgentFixture extends EventEmitter {
 readonly acceptsImages=true;
 count=0; cancelled=''; release?:()=>void; block=false; fail=false;
 async connect(){return {};}
 async newSession(){return {sessionId:'s'+(++this.count)};}
 async loadSession(){return {};}
 async prompt(id:string,text:string){
  if(this.fail&&text.startsWith('/title'))throw new Error('rename failed');
  if(this.block)await new Promise<void>(r=>this.release=r);
  this.emit('update',{sessionId:id,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Reply: '+text}}});
  return {stopReason:this.cancelled===id?'cancelled':'end_turn'};
 }
 cancel(id:string){this.cancelled=id;this.release?.();}
 async setMode(){return {};}
 async setModel(){return {};}
 dispose(){}
}
const control:SessionControl={
 inspect:async()=>({model:'test-model',provider:'test',baseUrl:'',effort:'low',wireEffort:'low',approvalPolicy:'ask',capabilities:{values:['none','low','high'],note:'test fixture'}}),
 setEffort:async(_id,value)=>({...await control.inspect(''),effort:value}),
 catalog:async()=>({values:['none','low','high'],note:'test fixture'}),
 compact:async(id:string)=>({sessionId:id,compressed:true,messages:0}),
 capabilities:async(p:string,m:string)=>({values:['none','low','high'],note:'test fixture'}),
 modelInfo:async()=>({provider:'p',providerLabel:'P',model:'m',baseUrl:'',lab:'',context:null,contextSource:'',catalogName:'',capabilities:{values:[],note:''}}),
 rename:async(id:string,title:string)=>({sessionId:id,title})
};

test('controller streams into the right session, rejects concurrent turns and confirms effort',async()=>{
 const client=new AgentFixture();const controller=new SessionController(client,control,()=>process.cwd(),()=>1);
 const s=await controller.create();
 await controller.setEffort(s.id,'high');assert.equal(s.info?.effort,'high');
 client.block=true;
 const run=controller.send(s.id,'hello');
 await assert.rejects(()=>controller.send(s.id,'second'),/busy/i);
 controller.cancel(s.id);await run;
 assert.equal(s.status,'cancelled'); assert.equal(s.messages[1].text,'Reply: hello');
 await assert.rejects(()=>controller.setEffort(s.id,'max'),/unsupported/i);
 controller.dispose();
});

test('rename goes through the session mutation, normalizes the name, and never adopts an unconfirmed one',async()=>{
 const calls:{id:string;title:string}[]=[];
 let refuse= false;
 const recording:SessionControl={...control,rename:async(id,title)=>{
  calls.push({id,title});
  if(refuse)throw new Error('Hermes did not store this title; it may already be in use');
  return {sessionId:id,title};
 }};
 const client=new AgentFixture();const controller=new SessionController(client,recording,()=>process.cwd(),()=>1);
 const s=await controller.create();
 const renamed:{id:string;title:string}[]=[];
 controller.recent=(id,title)=>renamed.push({id,title});
 await controller.rename(s.id,'  My   fix for\nthe ladder  ');
 assert.equal(s.title,'My fix for the ladder','whitespace collapses and the title is trimmed');
 assert.deepEqual(calls.at(-1),{id:s.id,title:'My fix for the ladder'},'the bridge receives the cleaned title');
 assert.deepEqual(renamed.at(-1),{id:s.id,title:'My fix for the ladder'},'the recent list is told');
 assert.equal(client.fail,false);
 // A rename must never reach the model: the fixture records prompts only when one is sent.
 assert.equal((client as unknown as {prompts?:string[]}).prompts?.length??0,0,'no prompt is sent');
 await assert.rejects(()=>controller.rename(s.id,'   '),/Enter a session name/);
 await assert.rejects(()=>controller.rename(s.id,'x'.repeat(121)),/120/);
 assert.equal(s.title,'My fix for the ladder','rejected names never change the title');
 // An unconfirmed rename must not be shown as applied.
 refuse=true;
 await assert.rejects(()=>controller.rename(s.id,'Nope'),/did not store/);
 assert.equal(s.title,'My fix for the ladder','the previous name survives a refusal');
 assert.equal(s.status,'idle','the session is usable again after a failed rename');
 controller.dispose();
});

test('an unconfirmed model switch is inspected, never retried, and blocks the session',async()=>{
 const client=new AgentFixture();
 let calls=0,model='test-model';
 client.setModel=async()=>{calls++;throw new Error('session/set_model timed out; its outcome MAY BE UNKNOWN. Reconnect before retrying.');};
 const recording:SessionControl={...control,inspect:async()=>({...await control.inspect(''),model})};
 const controller=new SessionController(client,recording,()=>process.cwd(),()=>1);
 const s=await controller.create();
 // The switch landed on Hermes' side even though the reply was lost: adopt it, do not re-send.
 model='new-model';
 await controller.setModel(s.id,'new-model','test');
 assert.equal(s.info?.model,'new-model');
 assert.equal(calls,1,'the timed-out switch is not sent twice');
 assert.equal(s.status,'idle','a confirmed switch leaves the session usable');
 // Nothing landed this time: the session is marked disconnected so a blind retry is impossible.
 await assert.rejects(()=>controller.setModel(s.id,'other','test'),/did not confirm/i);
 assert.equal(s.status,'disconnected');
 assert.equal(calls,2);
 await assert.rejects(()=>controller.setModel(s.id,'other','test'),/disconnected/i);
 assert.equal(calls,2,'a disconnected session never reaches the wire again');
 controller.dispose();
});

test('worker preset controls an isolated session, enforces concurrency, and preserves errors',async()=>{
 const client=new AgentFixture();client.block=true;
 const controller=new SessionController(client,control,()=>process.cwd(),()=>1);
 const preset={id:'p',name:'Reviewer',provider:'',model:'',effort:'high',instructions:'Read only'};
 const run=controller.runWorker(preset,'Review code');
 await new Promise(r=>setTimeout(r,5));
 await assert.rejects(()=>controller.runWorker(preset,'Second'),/parallel/i);
 const s=controller.sessions[0];assert.equal(s.kind,'worker');assert.equal(s.info?.effort,'high');
 controller.cancel(s.id);await run;
 assert.match(s.messages[0].text,/Read only/); assert.match(s.messages[0].text,/Review code/);
 controller.dispose();
});
