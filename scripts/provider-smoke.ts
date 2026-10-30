import {HermesControl} from '../src/infrastructure/HermesControl';
import {homedir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// HERMES_HOME must point at a throwaway profile: this test writes config.yaml and .env.
const home=process.env.HERMES_HOME??'';
if(!home)throw new Error('Set HERMES_HOME to a throwaway profile before running this probe');

async function main(){
 const control=new HermesControl(path.join(homedir(),'.local/bin/hermes'),path.resolve('bridge/control.py'),home);
 const test=await control.testProvider('http://localhost:11434/v1','');
 console.log('probe:',JSON.stringify(test).slice(0,160));
 assert.equal(test.ok,true,'local Ollama answers /v1/models');
 const saved=await control.saveProvider({id:'ollama-local',label:'Ollama Local',
  baseUrl:'http://localhost:11434/v1',apiKey:'',defaultModel:'lfm3:latest'});
 console.log('saved:',JSON.stringify({...saved,models:saved.models.slice(0,3)}));
 assert.equal(saved.id,'ollama-local');
 assert.ok(saved.models.length,'the endpoint advertised models at save time');
 console.log('OK');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
