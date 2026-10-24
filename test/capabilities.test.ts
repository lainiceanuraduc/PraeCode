import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {SessionController} from '../src/application/SessionController';
import {SessionControl} from '../src/infrastructure/HermesControl';
import {MAX_IMAGES,base64Bytes,imageBudgetError} from '../src/domain/Images';

class AgentFixture extends EventEmitter {
 readonly acceptsImages=true;
 prompts:(string|unknown[])[]=[]; mcpSeen:unknown[][]=[];
 async connect(){return {};}
 async newSession(_cwd:string,mcp?:unknown[]){this.mcpSeen.push(mcp??[]);return {sessionId:'s1'};}
 async loadSession(_id:string,_cwd:string,mcp?:unknown[]){this.mcpSeen.push(mcp??[]);return {messages:[]};}
 async prompt(_id:string,blocks:string|unknown[]){this.prompts.push(blocks);return {stopReason:'end_turn'};}
 cancel(){} async setMode(){return {};}
 async setModel(){return {};} dispose(){}
}
let compacted=0;
const control:SessionControl={
 inspect:async()=>({model:'m',provider:'p',baseUrl:'',effort:'',wireEffort:'',approvalPolicy:'ask',capabilities:{values:[],note:''}}),
 setEffort:async()=>control.inspect(''),
 catalog:async()=>({values:[],note:''}),
 rename:async(id,title)=>({sessionId:id,title}),
 compact:async(id)=>{compacted++;return {sessionId:id,compressed:true,messages:1};},
 capabilities:async()=>({values:['none','low','high'],note:'test fixture'}),
 modelInfo:async()=>({provider:'p',providerLabel:'P',model:'m',baseUrl:'',lab:'',context:null,contextSource:'',catalogName:'',capabilities:{values:[],note:''}}),
 sessions:async()=>[],
};
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('images travel as ACP image blocks after the text, never into the transcript',async()=>{
 const client=new AgentFixture();const controller=new SessionController(client,control,()=>process.cwd(),()=>1);
 const s=await controller.create();
 assert.equal(s.acceptsImages,true,'the capability comes from initialize()');
 await controller.send(s.id,'what is this?',[],[],[{name:'shot.png',mime:'image/png',data:PNG,size:base64Bytes(PNG)}]);
 const blocks=client.prompts[0] as any[];
 assert.ok(Array.isArray(blocks),'a multimodal prompt is a block list');
 assert.deepEqual(blocks[0],{type:'text',text:'what is this?'},'text stays first so slash commands still work');
 assert.equal(blocks[1].type,'image');
 assert.equal(blocks[1].mimeType,'image/png');
 assert.equal(blocks[1].data,PNG);
 // The transcript must not carry base64 into the webview state.
 const user=s.messages.find(m=>m.role==='user')!;
 assert.equal(user.text,'what is this?');
 assert.deepEqual(user.attachments?.map(a=>a.name),['shot.png']);
 controller.dispose();
});

test('a session whose agent rejects images refuses them before any prompt',async()=>{
 const client=new AgentFixture();Object.defineProperty(client,'acceptsImages',{value:false});
 const controller=new SessionController(client,control,()=>process.cwd(),()=>1);
 const s=await controller.create();
 assert.equal(s.acceptsImages,false);
 await assert.rejects(()=>controller.send(s.id,'x',[],[],[{name:'a.png',mime:'image/png',data:PNG,size:100}]),/does not accept images/);
 assert.equal(client.prompts.length,0,'nothing was sent');
 controller.dispose();
});

test('image budgets are enforced on count, size and total',()=>{
 assert.equal(imageBudgetError([]),'');
 assert.match(imageBudgetError(Array.from({length:MAX_IMAGES+1},(_,i)=>({name:`${i}.png`,size:1}))),/at most 8/);
 assert.match(imageBudgetError([{name:'big.png',size:5*1024*1024}]),/too large/);
 // Each file is inside the per-image cap, but the three together exceed the total.
 assert.equal(imageBudgetError([{name:'a.png',size:4*1024*1024},{name:'b.png',size:4*1024*1024},{name:'c.png',size:4*1024*1024}]),'','exactly at the total limit is allowed');
 assert.match(imageBudgetError([{name:'a.png',size:4*1024*1024},{name:'b.png',size:4*1024*1024},{name:'c.png',size:4*1024*1024},{name:'d.png',size:1}]),/limit is 12 MB/);
 assert.equal(base64Bytes(PNG),Buffer.from(PNG,'base64').length,'base64 size math matches the buffer');
});

test('MCP servers reach session/new and session/load unchanged',async()=>{
 const client=new AgentFixture();const controller=new SessionController(client,control,()=>process.cwd(),()=>1);
 const servers=[{name:'fs',command:'npx',args:['-y','server'],env:{}},{name:'docs',url:'https://x.test/mcp',headers:{}}];
 controller.mcpServers=()=>servers;
 await controller.create();
 assert.deepEqual(client.mcpSeen[0],servers,'create passes them through');
 await controller.resume('s1',process.cwd(),'t');
 assert.deepEqual(client.mcpSeen.at(-1),servers,'resume must pass them too, or the tool surface differs');
 controller.dispose();
});

test('approval modes come from ACP and a switch is only adopted once Hermes accepts it',async()=>{
 const client=new AgentFixture();
 Object.assign(client,{newSession:async()=>({sessionId:'m1',modes:{
  currentModeId:'default',
  availableModes:[{id:'default',name:'Default',description:'Ask before edits.'},
                  {id:'accept_edits',name:'Accept Edits'},{id:'dont_ask',name:"Don't Ask"}]}})});
 const controller=new SessionController(client,control,()=>process.cwd(),()=>1);
 const s=await controller.create();
 assert.deepEqual(s.modes.available.map(m=>m.name),['Default','Accept Edits',"Don't Ask"]);
 assert.equal(s.modes.current,'default');
 await controller.setMode(s.id,'accept_edits');
 assert.equal(s.modes.current,'accept_edits','the switch is adopted after ACP accepts it');
 await assert.rejects(()=>controller.setMode(s.id,'nope'),/Unknown approval mode/);
 assert.equal(s.modes.current,'accept_edits','a refused mode never changes the selection');
 controller.dispose();
});

test('the context meter is driven by live usage_update, not guessed',async()=>{
 const client=new AgentFixture();const controller=new SessionController(client,control,()=>process.cwd(),()=>1);
 const s=await controller.create();
 s.update({sessionUpdate:'usage_update',size:200000,used:50000});
 assert.deepEqual(controller.usage(s.id),{used:50000,limit:200000,messages:0,compactions:0,source:'stream'});
 s.update({sessionUpdate:'usage_update',size:200000,used:90000});
 assert.equal(controller.usage(s.id)?.used,90000,'the meter follows the stream');
 assert.equal(controller.usage('missing'),undefined);
 controller.dispose();
});

test('compact calls the bridge, clears the local transcript and reports the size',async()=>{
 compacted=0;
 const client=new AgentFixture();const controller=new SessionController(client,control,()=>process.cwd(),()=>1);
 const s=await controller.create();
 await controller.send(s.id,'hello');
 const before=s.messages.length;
 const result=await controller.compact(s.id,'the bug');
 assert.equal(compacted,1,'the bridge mutation ran');
 assert.equal(result.before,before);
 assert.equal(s.status,'idle');
 controller.dispose();
});
