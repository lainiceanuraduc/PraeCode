import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { BRIDGE_DIR_ENV, bridgePrelude, parseRuntimeCommand } from '../domain/RuntimeCommand';
import { promisify } from 'node:util';
import path from 'node:path';

export interface EffortCapabilities { values: string[]; note: string; }
export interface ContextUsage { used: number | null; limit: number | null; messages: number; compactions: number; /** Where the window came from: live stream, an inspect, or the model catalog. */ source?: 'stream'|'session'|'catalog'; }
// `undefined` means Hermes did not report it; the UI shows "unknown" rather than a fake number.
/** Provider/model facts the picker's detail pane shows; `context` is null when no source published it. */
export interface ModelDetails {
 provider:string; providerLabel:string; model:string; baseUrl:string;
 lab:string; context:number|null; contextSource:''|'provider'|'catalog'; catalogName:string;
 capabilities:EffortCapabilities;
}
export interface SessionInfo { model: string; provider: string; baseUrl: string; effort: string; wireEffort: string; approvalPolicy: string; capabilities: EffortCapabilities; context?: ContextUsage; messages?: number; }
export interface SessionControl {
 inspect(sessionId: string): Promise<SessionInfo>;
 setEffort(sessionId: string, value: string): Promise<SessionInfo>;
 catalog(provider: string, model: string, baseUrl?: string): Promise<EffortCapabilities>;
 /** Metadata edit on the Hermes session itself, so the title survives a resume. */
 rename(sessionId: string, title: string): Promise<{sessionId:string;title:string}>;
 /** Manual compaction (`session.mutate compress`); the summary is Hermes-owned. */
 compact(sessionId: string, focus?: string): Promise<{sessionId:string;compressed:boolean;messages?:number;summary?:string}>;
 /** Fetch the effort ladder for a model without mutating anything (for the selector). */
 capabilities(provider: string, model: string, baseUrl?: string): Promise<EffortCapabilities>;
/** Conversations Hermes persists for this workspace; the editor keeps no transcript of its own. */
 sessions(cwd: string): Promise<{id:string;title:string;cwd:string;messages:number;updatedAt:string}[]>;
 /** Delegation policy plus every persisted child run Hermes knows about for this workspace. */
 subagents(cwd: string): Promise<import('../domain/Delegation').DelegationSnapshot>;
 /** Chat-capable models the Mistral account can use, with context, lab, capabilities and ladder. */
 mistralModels(): Promise<{count:number;models:{id:string;name:string;description:string;lab:string;
  context:number|null;aliases:string[];capabilities:Record<string,boolean>;labsGated:boolean;
  efforts:string[]|null;effortsSource:'discovered'|'seed'|'unknown'}[]}>;
 /** Probe one Mistral model for its exact reasoning ladder and cache the answer. */
 mistralDiscover(model:string): Promise<{model:string;levels:string[]|null;note:string;source:string}>;
 /** Write one provider into Hermes' `providers:` block; the key goes to the profile's .env. */
 saveProvider(draft:{id:string;label:string;baseUrl:string;apiKey:string;defaultModel:string}):
  Promise<import('../domain/ProviderDraft').ProviderSaveResult>;
 /** Probe an endpoint without writing anything. */
 testProvider(baseUrl:string,apiKey:string): Promise<{ok:boolean;models?:string[];count?:number;error?:string;catalogOnly?:boolean}>;
 /** Facts about a model the session is not running on yet: lab, context window, effort ladder. */
 modelInfo(provider: string, model: string, baseUrl?: string): Promise<ModelDetails>;
}

/** Uses Hermes' own Python/runtime, with a small explicit protocol on stdin. */
export class HermesControl implements SessionControl {
 constructor(private hermes: string, private script: string, private home?: string, private python?: string) {}
 catalog(provider: string, model: string, baseUrl = ''): Promise<EffortCapabilities> { return this.invoke({action:'catalog',provider,model,baseUrl}); }
 inspect(sessionId: string): Promise<SessionInfo> { return this.invoke({action:'inspect',sessionId}); }
 setEffort(sessionId: string, value: string): Promise<SessionInfo> { return this.invoke({action:'effort',sessionId,value}); }
 rename(sessionId: string, title: string): Promise<{sessionId:string;title:string}> { return this.invoke({action:'rename',sessionId,title}); }
 compact(sessionId: string, focus = ''): Promise<{sessionId:string;compressed:boolean;messages?:number;summary?:string}> { return this.invoke({action:'compact',sessionId,focus}); }
 capabilities(provider: string, model: string, baseUrl = ''): Promise<EffortCapabilities> { return this.invoke({action:'catalog',provider,model,baseUrl}); }
 modelInfo(provider: string, model: string, baseUrl = ''): Promise<ModelDetails> { return this.invoke({action:'modelinfo',provider,model,baseUrl}); }
 mistralModels(): Promise<{count:number;models:{id:string;name:string;description:string;lab:string;
  context:number|null;aliases:string[];capabilities:Record<string,boolean>;labsGated:boolean;
  efforts:string[]|null;effortsSource:'discovered'|'seed'|'unknown'}[]}> { return this.invoke({action:'mistral_models'}); }
 mistralDiscover(model:string): Promise<{model:string;levels:string[]|null;note:string;source:string}> { return this.invoke({action:'mistral_discover',model}); }
 saveProvider(draft:{id:string;label:string;baseUrl:string;apiKey:string;defaultModel:string}):
  Promise<import('../domain/ProviderDraft').ProviderSaveResult> { return this.invoke({action:'provider_save',...draft}); }
 testProvider(baseUrl:string,apiKey:string): Promise<{ok:boolean;models?:string[];count?:number;error?:string;catalogOnly?:boolean}> {
  return this.invoke({action:'provider_test',baseUrl,apiKey});
 }
 subagents(cwd: string): Promise<import('../domain/Delegation').DelegationSnapshot> { return this.invoke({action:'subagents',cwd}); }
 sessions(cwd: string): Promise<{id:string;title:string;cwd:string;messages:number;updatedAt:string}[]> { return this.invoke({action:'sessions',cwd}); }
 /**
  * The launcher to spawn, and the environment it needs.
  *
  * Everything Hermes prints is validated as data (`parseRuntimeCommand`); the bridge directory travels
  * in `BRIDGE_DIR_ENV` so no path is ever interpolated into the `-c` source. With
  * `radcode.pythonPath` set the script is executed directly, which needs neither.
  */
 private async command(): Promise<{argv:string[];env:Record<string,string>}> {
  if(this.python) return {argv:[this.python,this.script],env:{}};
  const {stdout}=await promisify(execFile)(this.hermes,['--print-runtime-command','--module',path.basename(this.script,'.py')],{timeout:30_000,windowsHide:true})
   .catch((e:NodeJS.ErrnoException)=>{
    // Say what is wrong instead of surfacing "spawn ... ENOENT" from the child_process layer.
    if(e.code==='ENOENT')throw new Error(`Hermes is not installed at "${this.hermes}". Install Hermes, or set radcode.hermesPath to the hermes executable.`);
    throw e;
   });
  let printed:unknown;
  try{printed=JSON.parse(stdout);}catch{throw new Error('Hermes printed an unreadable runtime command; set radcode.pythonPath.');}
  const {argv}=parseRuntimeCommand(printed,p=>existsSync(p));
  return {argv:[argv[0],argv[1],argv[2],bridgePrelude()+argv[3]],env:{[BRIDGE_DIR_ENV]:path.dirname(this.script)}};
 }
 private async invoke<T>(request: unknown): Promise<T> {
  const {argv,env}=await this.command();
  return new Promise((resolve,reject)=>{
   const processHandle=spawn(argv[0], argv.slice(1), {
    shell:false,windowsHide:true,env:{...process.env,...env,...(this.home ? {HERMES_HOME:this.home}:{})},stdio:['pipe','pipe','pipe']
   });
   let output='', error='', settled=false;
   const finish=(failure?:Error,result?:T)=>{
    if(settled)return; settled=true;clearTimeout(timer);
    failure?reject(failure):resolve(result!);
   };
   const timer=setTimeout(()=>{processHandle.kill();finish(new Error('Hermes control timed out; no setting is assumed applied.'));},60_000);
   processHandle.stdout.on('data',b=>{output+=b;if(output.length>1024*1024){processHandle.kill();finish(new Error('Unexpected helper output size'));}});
   processHandle.stderr.on('data',b=>{error=(error+String(b)).slice(-2000);});
   processHandle.on('error',e=>finish(e));
   processHandle.stdin.on('error',e=>finish(e));
   processHandle.on('close',()=>{
    try {const message=JSON.parse(output.trim()); if(!message.ok)throw new Error(message.error);finish(undefined,message.result);}
    catch(e){finish(new Error(`Hermes controls unavailable: ${output.trim().startsWith('{')?String(e):'runtime helper could not start. Set radcode.pythonPath to the Hermes Python interpreter, or update Hermes.'}`));}
   });
   processHandle.stdin.end(JSON.stringify(request)+'\n');
  });
 }
}
