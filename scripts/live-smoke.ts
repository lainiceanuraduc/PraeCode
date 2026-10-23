import {AcpClient} from '../src/infrastructure/AcpClient';
import {HermesControl} from '../src/infrastructure/HermesControl';
import path from 'node:path';
import assert from 'node:assert/strict';

async function main(){
 const hermes=process.env.RADCODE_HERMES || 'hermes';
 const client=new AcpClient({executable:hermes,cwd:process.cwd()});
 const control=new HermesControl(hermes,path.resolve('bridge/control.py'));
 let text='';
 client.on('update',p=>{if(p.update?.sessionUpdate==='agent_message_chunk')text+=p.update.content?.text||'';});
 client.on('diagnostic',m=>{if(process.env.DEBUG_RADCODE)process.stderr.write(m);});
 try{
  const init=await client.connect();console.log('ACP initialize:',JSON.stringify(init.agentInfo));
  const s=await client.newSession(process.cwd()); console.log('Created test session:',s.sessionId);
  const info=await control.inspect(s.sessionId);console.log('Session controls:',JSON.stringify(info));
  if(info.capabilities.values.length){
   const value=info.capabilities.values[0];
   const applied=await control.setEffort(s.sessionId,value);assert.equal(applied.effort,value);
   console.log('Effort read-back confirmed:',value);
  }
  if(process.env.RADCODE_LIVE_PROMPT==='1'){
   const result=await client.prompt(s.sessionId,'Reply with exactly RADCODE_OK. Do not call any tools.');
   console.log('Prompt stop reason:',result.stopReason,'Reply:',JSON.stringify(text));
   assert.match(text,/RADCODE_OK/);
  }
 }finally{client.dispose();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
