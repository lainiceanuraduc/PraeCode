import {element} from './dom';
import type {AgentPreset} from '../domain/PresetRepository';
import type {ViewState} from './types';

export class AgentMenu {
 constructor(private post:(message:any)=>void) {
  element('new-preset').onclick=()=>this.edit();
  element('cancel-preset').onclick=()=>{element('preset-form').hidden=true;};
  element('check-effort').onclick=()=>this.checkCapabilities();
  element('preset-provider').onchange=()=>this.resetEffort();element('preset-model').onchange=()=>this.resetEffort();
  element('preset-form').onsubmit=e=>{
   e.preventDefault();
   const value=(id:string)=>(element<HTMLInputElement>(id).value);
   this.post({type:'savePreset',preset:{id:value('preset-id')||undefined,name:value('preset-name'),provider:value('preset-provider'),model:value('preset-model'),effort:value('preset-effort'),instructions:value('preset-instructions')}});
  };
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
