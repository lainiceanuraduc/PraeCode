import {AcpClient} from '../src/infrastructure/AcpClient';
import {HermesControl} from '../src/infrastructure/HermesControl';
import {SessionController} from '../src/application/SessionController';
import assert from 'node:assert/strict';
import path from 'node:path';

async function main(){
 const client=new AcpClient({executable:process.env.RADCODE_HERMES||'hermes',cwd:process.cwd()});
 const control=new HermesControl(process.env.RADCODE_HERMES||'hermes',path.resolve('bridge/control.py'));
 const controller=new SessionController(client,control,()=>process.cwd(),()=>2);
 try{
  const preset={id:'smoke',name:'Smoke worker',provider:'',model:'',effort:'medium',instructions:'You are a worker. Do not call tools.'};
  await controller.runWorker(preset,'Reply with exactly WORKER_OK and nothing else.');
  const session=controller.sessions.find(s=>s.kind==='worker');
  assert.ok(session);
  const output=controller.result(session.id);
  console.log('worker status:',session.status,'| effort:',session.info?.effort,'| wire:',session.info?.wireEffort);
  console.log('worker output:',JSON.stringify(output.slice(0,200)));
  assert.match(output,/WORKER_OK/);
  const main_=await controller.create();
  console.log('main session created for hand-off:',main_.id.slice(0,18));
 }finally{controller.dispose();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
