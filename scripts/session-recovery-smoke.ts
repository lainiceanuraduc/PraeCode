import {HermesControl} from '../src/infrastructure/HermesControl';
import {homedir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

async function main(){
 const control=new HermesControl(path.join(homedir(),'.local/bin/hermes'),path.resolve('bridge/control.py'));
 const saved=await control.sessions(process.cwd());
 assert.ok(saved.length,'Expected persisted conversations for this workspace');
 assert.ok(saved.every(s=>s.cwd===process.cwd()),'Every listed conversation belongs to this workspace');
 assert.ok(saved[0].id&&saved[0].messages>0,'The newest conversation has an id and messages');
 console.log(`Hermes catalog lists ${saved.length} conversations for this workspace.`);
 console.log(`Newest: ${saved[0].title||'(untitled)'} · ${saved[0].messages} messages · ${saved[0].id}`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
