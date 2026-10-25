import {element} from './dom';
import type {AgentPreset} from '../domain/PresetRepository';
import type {ViewState} from './types';
import {delegationHeadline,describeAge,describeDuration,policyChips,runState} from '../domain/Delegation';
import type {DelegationRun,DelegationSnapshot} from '../domain/Delegation';

export class AgentMenu {
 constructor(private post:(message:any)=>void) {
  element('new-preset').onclick=()=>this.edit();
  element('cancel-preset').onclick=()=>{element('preset-form').hidden=true;};
  element('check-effort').onclick=()=>this.checkCapabilities();
  element('refresh-subagents').onclick=()=>{element('delegation-headline').textContent='Refreshing…';this.post({type:'subagents'});};
  element('preset-provider').onchange=()=>this.resetEffort();element('preset-model').onchange=()=>this.resetEffort();
  element('preset-form').onsubmit=e=>{
   e.preventDefault();
   const value=(id:string)=>(element<HTMLInputElement>(id).value);
   this.post({type:'savePreset',preset:{id:value('preset-id')||undefined,name:value('preset-name'),provider:value('preset-provider'),model:value('preset-model'),effort:value('preset-effort'),instructions:value('preset-instructions')}});
  };
 }
 /**
  * Hermes' own delegation state: the policy that governs child runs, then what is live and what
  * finished. Only facts the bridge reported are shown; a missing field reads as unknown, never as a
  * guessed default.
  */
 delegation(snapshot:DelegationSnapshot&{error?:string}):void{
  const state:DelegationSnapshot={policy:snapshot.policy,running:snapshot.running??[],recent:snapshot.recent??[]};
  element('delegation-headline').textContent=snapshot.error
   ?`Delegation status unavailable: ${snapshot.error}`
   :delegationHeadline(state);
  const chips=element('delegation-policy');chips.replaceChildren();
  for(const chip of policyChips(state.policy)){
   const span=document.createElement('span');span.className='policy-chip';
   const label=document.createElement('span');label.className='policy-label';label.textContent=chip.label;
   const value=document.createElement('span');value.className='policy-value';value.textContent=chip.value;
   span.append(label,value);chips.append(span);
  }
  chips.hidden=!chips.children.length;
  this.runs('delegation-running',state.running,'No child run is active right now.');
  this.runs('delegation-recent',state.recent,'Hermes recorded no finished child runs for this workspace.');
 }

 /** One card per child run, with the numbers Hermes stored: model, messages, tools, duration. */
 private runs(host:string,runs:DelegationRun[],empty:string):void{
  const mount=element(host);mount.replaceChildren();
  if(!runs.length){const p=document.createElement('p');p.className='caption';p.textContent=empty;mount.append(p);return;}
  const now=Date.now()/1000;
  for(const run of runs){
   const state=runState(run);
   const card=document.createElement('div');card.className='run-card';
   const title=document.createElement('h2');title.textContent=run.title;
   const status=document.createElement('p');status.className=`caption delegation-status ${state}`;
   const parts:string[]=[state];
   if(run.model)parts.push(run.model);
   parts.push(`from “${run.parentTitle}”`);
   const detail:string[]=[];
   if(run.messages)detail.push(`${run.messages} msgs`);
   if(run.tools)detail.push(`${run.tools} tools`);
   if(run.endedAt&&run.startedAt)detail.push(describeDuration(run.endedAt-run.startedAt));
   else if(run.startedAt)detail.push(`started ${describeAge(now,run.startedAt)}`);
   if(detail.length)parts.push(detail.join(' · '));
   if(state!=='running'&&run.lastActivityAt)parts.push(`last activity ${describeAge(now,run.lastActivityAt)}`);
   status.textContent=parts.join(' — ');
   card.append(title,status);mount.append(card);
  }
 }

 private resetEffort():void {this.options([],'default');element('preset-note').textContent='Check supported levels after choosing provider and model.';}
 private checkCapabilities():void {
  const provider=element<HTMLInputElement>('preset-provider').value,model=element<HTMLInputElement>('preset-model').value;
  this.post({type:'catalog',provider,model});element('preset-note').textContent='Reading installed Hermes capabilities…';
 }
 capabilities(values:string[],note:string,provider:string,model:string):void {
  if(provider!==element<HTMLInputElement>('preset-provider').value||model!==element<HTMLInputElement>('preset-model').value)return;
  this.options(values,element<HTMLSelectElement>('preset-effort').value);element('preset-note').textContent=note;
 }
 saved():void {element('preset-form').hidden=true;}
 private options(values:string[],selected:string):void {
  const select=element<HTMLSelectElement>('preset-effort');select.replaceChildren();
  for(const value of ['default',...values.filter(v=>v!=='default')])select.add(new Option(value==='default'?'Profile default':value==='none'?'None / Off':value,value));
  select.value=values.includes(selected)?selected:'default';
 }
 private edit(p?:AgentPreset):void {
  element('preset-form').hidden=false;
  for(const [name,value] of Object.entries({id:p?.id??'',name:p?.name??'',provider:p?.provider??'',model:p?.model??'',instructions:p?.instructions??''}))(element<HTMLInputElement>('preset-'+name)).value=value;
  // A saved effort is shown but must be checked again if its provider/model changes.
  this.options(p&&p.effort!=='default'?[p.effort]:[],p?.effort??'default');
  element('preset-note').textContent='Check supported levels to refresh capabilities for this model.';
  element('preset-name').focus();
 }
 render(state:ViewState):void {
  const list=element('preset-list');list.replaceChildren();
  if(!state.presets.length){const p=document.createElement('p');p.className='caption';p.textContent='Create a reviewer, researcher, or implementation worker.';list.append(p);}
  for(const preset of state.presets){
   const card=document.createElement('div');card.className='preset-card';
   const title=document.createElement('h2');title.textContent=preset.name;
   const description=document.createElement('div');description.className='caption';description.textContent=`${preset.provider||'Profile provider'} / ${preset.model||'Profile model'} · ${preset.effort}`;
   const actions=document.createElement('div');actions.className='actions';
   actions.append(this.button('Edit',()=>this.edit(preset),'secondary'),this.button('Delete',()=>this.post({type:'deletePreset',id:preset.id}),'secondary'),this.button('Run',()=>this.post({type:'runWorker',id:preset.id,task:element<HTMLTextAreaElement>('worker-task').value})));
   card.append(title,description,actions);list.append(card);
  }
  element('worker-limit').textContent=`Up to ${state.maxWorkers??2} workers at once. Change this in extension settings. Model usage may incur provider charges.`;
  const runs=element('worker-runs');runs.replaceChildren();
  for(const session of state.sessions.filter(s=>s.kind==='worker')){
   const card=document.createElement('div');card.className='run-card';
   const title=document.createElement('h2');title.textContent=session.title;
   const status=document.createElement('p');status.className='caption';status.textContent=`${session.status} · ${session.info?.model??'Connecting'}`;
   const actions=document.createElement('div');actions.className='actions';
   actions.append(this.button('View',()=>this.post({type:'select',id:session.id}),'secondary'));
   if(session.status==='running')actions.append(this.button('Stop',()=>this.post({type:'cancel',id:session.id}),'secondary'));
   else actions.append(this.button('Use result',()=>this.post({type:'useResult',id:session.id}),'secondary'));
   card.append(title,status,actions);runs.append(card);
  }
  if(!runs.children.length){const p=document.createElement('p');p.className='caption';p.textContent='No workers started yet.';runs.append(p);}
 }
 private button(text:string,action:()=>void,className=''):HTMLButtonElement {const b=document.createElement('button');b.textContent=text;b.className=className;b.onclick=action;return b;}
}
