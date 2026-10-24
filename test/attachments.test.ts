import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {MAX_ATTACHMENTS,attachmentBudgetError,attachmentLabel,composePrompt} from '../src/domain/Attachments';
import {SessionController} from '../src/application/SessionController';
import {SessionControl} from '../src/infrastructure/HermesControl';

class AgentFixture extends EventEmitter {
 readonly acceptsImages=true;
 prompts:string[]=[];
 async connect(){return {};}
 async newSession(){return {sessionId:'s1'};}
 async loadSession(){return {};}
 async prompt(_id:string,text:string){this.prompts.push(text);return {stopReason:'end_turn'};}
 cancel(){} async setMode(){return {};}
 async setModel(){return {};}
 dispose(){}
}
const control:SessionControl={
 inspect:async()=>({model:'m',provider:'p',baseUrl:'',effort:'',wireEffort:'',approvalPolicy:'ask',capabilities:{values:[],note:''}}),
 setEffort:async()=>control.inspect(''),
 catalog:async()=>({values:[],note:''}),
 compact:async(id:string)=>({sessionId:id,compressed:true,messages:0}),
 capabilities:async(p:string,m:string)=>({values:['none','low','high'],note:'test fixture'}),
 modelInfo:async()=>({provider:'p',providerLabel:'P',model:'m',baseUrl:'',lab:'',context:null,contextSource:'',catalogName:'',capabilities:{values:[],note:''}}),
 sessions:async()=>[],
 rename:async(id:string,title:string)=>({sessionId:id,title})
};

test('prompt carries file bodies, transcript carries only names',async()=>{
 const client=new AgentFixture();const controller=new SessionController(client,control,()=>process.cwd(),()=>1);
 const s=await controller.create();
 const files=[{path:'/w/a.ts',name:'a.ts',line:4,size:11},{path:'/w/b.md',name:'b.md',size:5}];
 await controller.send(s.id,'Why does this fail?',files,['const a = 1','# doc']);
 assert.match(client.prompts[0],/^Why does this fail\?/);
 assert.match(client.prompts[0],/--- file: a\.ts:4 \(11 bytes\) ---\nconst a = 1\n--- end: a\.ts:4 ---/);
 assert.match(client.prompts[0],/--- file: b\.md \(5 bytes\) ---\n# doc/);
 const user=s.messages.find(m=>m.role==='user')!;
 assert.equal(user.text,'Why does this fail?','the transcript keeps the typed text, not the file bodies');
 assert.deepEqual(user.attachments?.map(a=>a.name),['a.ts','b.md']);
 controller.dispose();
});

test('attachment-only send works, and mismatched contents are refused before any prompt',async()=>{
 const client=new AgentFixture();const controller=new SessionController(client,control,()=>process.cwd(),()=>1);
 const s=await controller.create();
 await controller.send(s.id,'',[{path:'/w/a.ts',name:'a.ts',size:3}],['abc']);
 assert.equal(s.messages[0].text,'Attached 1 item(s)');
 await assert.rejects(()=>controller.send(s.id,'x',[{path:'/w/a.ts',name:'a.ts',size:3}],[]),/do not match/);
 assert.rejects(()=>controller.send(s.id,'   '),/must contain/);
 controller.dispose();
});

test('budget and labels: count, per-file size and total are enforced',()=>{
 assert.equal(attachmentBudgetError([]),'');
 assert.match(attachmentBudgetError(Array.from({length:MAX_ATTACHMENTS+1},(_,i)=>({path:`/w/${i}`,name:`${i}`,size:1}))),/at most 12/);
 assert.match(attachmentBudgetError([{path:'/w/big',name:'big.bin',size:600*1024}]),/too large/);
 assert.match(attachmentBudgetError([{path:'/w/a',name:'a',size:400*1024},{path:'/w/b',name:'b',size:400*1024},{path:'/w/c',name:'c',size:400*1024}]),/limit is 1024 KB/);
 assert.equal(attachmentLabel({name:'a.ts',line:7}),'a.ts:7');
 assert.equal(attachmentLabel({name:'a.ts'}),'a.ts');
 assert.equal(composePrompt('q',[],[]),'q\n');
});
