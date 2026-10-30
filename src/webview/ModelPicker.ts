/**
 * The model-picker modal: favorites on the left, every model the provider offers on the right, and
 * the selected model's real details underneath (thinking ladder, context window, provider, lab).
 *
 * The lists are derived from the ACP `availableModels` the session already published, so the id the
 * picker sends back is exactly the id Hermes accepts. Favorites are ids the host persists; starring
 * in the all-models list adds, starring in the favorites list removes.
 */
import {element} from './dom';
import {capabilityChips, groupModels, modelBlockedReason, providerOf, toggleFavorite} from '../domain/ModelCatalog';
import type {MistralModelFacts} from '../domain/ModelCatalog';
import type {ProviderGroup} from '../domain/ModelCatalog';
import type {ModelDetailsView} from './types';

export class ModelPicker {
 private groups:ProviderGroup[]=[];
 private favorites:string[]=[];
 private sessions:{modelId:string;name?:string;description?:string}[]=[];
 private selected='';
 private sessionId='';
 private requestId='';
 /** Facts from the provider's own model list, keyed by bare model id (Mistral only, for now). */
 private facts=new Map<string,MistralModelFacts>();

 constructor(private post:(message:any)=>void){
  element('picker-close').onclick=()=>this.close();
  element('model-picker').addEventListener('close',()=>{element('picker-note').textContent='';});
  element('picker-provider').onchange=()=>this.renderAll();
  element('model-search').oninput=()=>this.renderAll();
  element('picker-use').onclick=()=>this.use();
  // Everything Hermes lists is in the modal; "Other…" keeps the old manual provider/model path.
  element('picker-manual').onclick=()=>{this.post({type:'manualModel',id:this.sessionId});this.close();};
  document.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&this.dialog().open)this.close();
  });
 }

 /** Open for one session: its models come from the last state push, favorites from the host. */
 open(models:{modelId:string;name?:string;description?:string}[],current:string,sessionId:string):void{
  this.sessions=models??[];
  this.sessionId=sessionId;
  this.selected=current;
  this.groups=groupModels(this.sessions,providerOf(current).provider);
  const select=element<HTMLSelectElement>('picker-provider');
  select.replaceChildren();
  for(const group of this.groups)select.add(new Option(`${group.label} (${group.models.length})`,group.slug));
  if(!this.groups.length)select.add(new Option('No models reported by Hermes',''));
  select.value=this.groups[0]?.slug??'';
  element<HTMLInputElement>('model-search').value='';
  this.post({type:'favoritesRequest'});
  this.renderAll();this.renderFavorites();this.renderDetails(undefined);
  if(!this.dialog().open)this.dialog().showModal();
  this.useButton().disabled=!this.selected;
  element('picker-note').textContent=this.selected?`Current: ${this.selected}`:'';
 }

 close():void{if(this.dialog().open)this.dialog().close();}
 private dialog():HTMLDialogElement{return element<HTMLDialogElement>('model-picker');}
 private useButton():HTMLButtonElement{return element<HTMLButtonElement>('picker-use');}

 /**
  * Provider facts for the rows: context window, lab, capability chips and whether the model is
  * blocked (a Labs model 403s without an organisation opt-in). Keyed by bare id so an alias row and
  * its canonical id share one entry.
  */
 setModelFacts(models:MistralModelFacts[]|undefined):void{
  this.facts=new Map((models??[]).map(m=>[m.id,m]));
  this.renderAll();this.renderFavorites();
 }

 /** The facts for a picker row, following the provider's alias list when the row is an alias. */
 private factsFor(id:string):MistralModelFacts|undefined{
  const bare=providerOf(id).model;
  const direct=this.facts.get(bare);
  if(direct)return direct;
  for(const facts of this.facts.values())if(facts.aliases?.includes(bare))return facts;
  return undefined;
 }

 /** The host owns the favorites list; adopt exactly what it stored and re-render both lists. */
 setFavorites(ids:string[]):void{this.favorites=Array.isArray(ids)?ids:[];this.renderFavorites();this.renderAll();}

 /** Details reply for the row that is selected right now; a late reply for another row is dropped. */
 setDetails(details:ModelDetailsView):void{
  const target=this.selected;
  if(!target)return;
  if(providerOf(target).model!==details.model)return;
  this.renderDetails(details);
 }

 private star(id:string,filled:boolean,label:string):HTMLButtonElement{
  const button=document.createElement('button');
  button.type='button';button.className=filled?'star filled':'star';
  button.setAttribute('aria-pressed',String(filled));
  button.setAttribute('aria-label',`${filled?'Remove':'Add'} ${label} ${filled?'from':'to'} favorites`);
  button.title=filled?'Remove from favorites':'Add to favorites';
  button.textContent=filled?'\u2605':'\u2606';
  button.onclick=event=>{event.stopPropagation();this.favorite(id,!filled);};
  return button;
 }

 private favorite(id:string,on:boolean):void{
  // Optimistic local update, then the host's stored list replaces it (it is the source of truth).
  this.favorites=on?toggleFavorite([...this.favorites.filter(x=>x!==id)],id):this.favorites.filter(x=>x!==id);
  this.renderFavorites();this.renderAll();
  this.post({type:'favorite',id,on});
 }

 private row(id:string,label:string,sub:string,filled:boolean,mount:(id:string)=>void):HTMLLIElement{
  const item=document.createElement('li');
  item.setAttribute('role','option');
  item.dataset.modelId=id;
  item.setAttribute('aria-selected',String(id===this.selected));
  if(id===this.selected)item.className='selected';
  const button=document.createElement('button');
  button.type='button';button.className='model-row';
  const name=document.createElement('span');name.className='model-name';name.textContent=label;
  const meta=document.createElement('span');meta.className='model-meta';meta.textContent=sub;
  button.append(name,meta);
  // Provider facts, when the host fetched them: a context window, capability chips, and the reason a
  // row cannot be used (a Labs model without organisation access).
  const facts=this.factsFor(id);
  if(facts){
   const row=document.createElement('span');row.className='model-facts';
   if(facts.context)row.append(this.chip(`${Math.round(facts.context/1000)}k ctx`,'ctx'));
   for(const chip of capabilityChips(facts))row.append(this.chip(chip,chip.startsWith('Labs')?'blocked':'cap'));
   if(facts.efforts){
    row.append(this.chip(`effort: ${facts.efforts.length?facts.efforts.join('/'):'none'}`,'effort'));
    // Say where the ladder came from: a probe of this account, or the shipped table.
    if(facts.effortsSource==='discovered')row.append(this.chip('verified','effort verified'));
   }
   if(row.children.length)button.append(row);
   const blocked=modelBlockedReason(facts);
   if(blocked){item.classList.add('blocked');button.disabled=true;button.title=blocked;}
  }
  button.onclick=():void=>{this.selected=id;mount(id);this.renderAll();this.renderFavorites();this.renderDetails(undefined);
   this.useButton().disabled=false;this.post({type:'modelInfo',provider:providerOf(id).provider,model:providerOf(id).model});};
  item.append(this.star(id,filled,label),button);
  return item;
 }

 private chip(text:string,kind:string):HTMLSpanElement{
  const span=document.createElement('span');
  span.className=`fact ${kind}`;
  span.textContent=text;
  return span;
 }

 private renderAll():void{
  const select=element<HTMLSelectElement>('picker-provider');
  const group=this.groups.find(g=>g.slug===select.value);
  const query=element<HTMLInputElement>('model-search').value.trim().toLowerCase();
  const list=element('model-list');list.replaceChildren();
  const rows=(group?.models??[]).filter(row=>!query||row.label.toLowerCase().includes(query));
  for(const row of rows)list.append(this.row(row.id,row.label,row.providerLabel,this.favorites.includes(row.id),id=>{
   const chosen=this.groups.flatMap(g=>g.models).find(m=>m.id===id);
   if(chosen)select.value=chosen.provider;
   element<HTMLInputElement>('model-search').value='';
  }));
  if(!rows.length){const p=document.createElement('li');p.className='caption';
   p.textContent=group?'No model matches this filter':'Hermes reported no models for this provider';list.append(p);}
  element('picker-note').textContent=group?`${group.models.length} model(s) offered by ${group.label}`:'';
 }

 private renderFavorites():void{
  const list=element('favorite-list');list.replaceChildren();
  const rows=this.favorites.map(id=>{
   const found=this.groups.flatMap(g=>g.models).find(m=>m.id===id);
   return found??{id,label:providerOf(id).model,provider:providerOf(id).provider,providerLabel:providerOf(id).provider};
  });
  for(const row of rows)list.append(this.row(row.id,row.label,row.providerLabel,true,()=>{}));
  // One empty state, not two: the paragraph below the list says it, so the list itself stays empty
  // (an empty <ul> is hidden by CSS) and never repeats the sentence inside a bordered box.
  element('favorites-empty').hidden=rows.length>0;
 }

 private renderDetails(details:ModelDetailsView|undefined):void{
  const dl=element('model-details');dl.replaceChildren();
  const add=(term:string,value:string):void=>{
   const dt=document.createElement('dt');dt.textContent=term;
   const dd=document.createElement('dd');dd.textContent=value;
   dl.append(dt,dd);
  };
  if(!this.selected){add('Model','Select a model to see its details.');return;}
  if(!details){
   add('Model',this.selected);
   add('Details','Reading this model from the provider…');
   return;
  }
  add('Model',details.catalogName&&details.catalogName!==details.model?`${details.model} — ${details.catalogName}`:details.model);
  add('Provider',details.providerLabel?`${details.providerLabel} (${details.provider||'unknown id'})`:details.provider||'Unknown');
  add('Lab',details.lab||'Not published by this provider');
  const context=details.context===null||details.context===undefined?'Unknown'
   :`${details.context.toLocaleString()} tokens${details.contextSource==='catalog'?' (model catalog)':''}`;
  add('Context',context);
  add('Thinking',details.capabilities.values.length?details.capabilities.values.join(', '):'No levels offered');
  add('Effort source',details.capabilities.note);
  if(details.baseUrl)add('Endpoint',details.baseUrl);
 }

 private use():void{
  if(!this.selected)return;
  this.post({type:'useModel',id:this.sessionId,value:this.selected});
  element('picker-note').textContent=`Switching to ${this.selected}…`;
  this.close();
 }
}
