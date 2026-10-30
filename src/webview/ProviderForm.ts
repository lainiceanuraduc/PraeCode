/**
 * The "Add a provider" form.
 *
 * A provider is an OpenAI-compatible endpoint Hermes can send turns to. The form validates locally
 * (instant feedback, and the same rules the host re-checks), offers a Test that probes the endpoint
 * without writing anything, and Save, which asks the host to write the `providers:` entry.
 *
 * The API key field is a password input and is never read back: after a save the host reports only
 * whether a key was stored, and the field is cleared.
 */
import {element} from './dom';
import {describeProvider, normalizeProviderId, providerDraftErrors} from '../domain/ProviderDraft';
import type {ProviderDraft, ProviderSaveResult} from '../domain/ProviderDraft';

export class ProviderForm {
 private busy=false;

 constructor(private post:(message:any)=>void){
  element('picker-add-provider').onclick=()=>this.open();
  element('provider-close').onclick=()=>this.close();
  element('provider-cancel').onclick=()=>this.close();
  element('provider-save').onclick=()=>this.save();
  element('provider-test').onclick=()=>this.test();
  // Enter in any field saves; Escape closes. The dialog is modal, so nothing behind it is reachable.
  element('provider-dialog').addEventListener('keydown',(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();this.close();}
   else if(event.key==='Enter'&&(event.target as HTMLElement).tagName==='INPUT'){event.preventDefault();this.save();}
  });
  element('provider-dialog').addEventListener('close',()=>this.note(''));
 }

 private dialog():HTMLDialogElement{return element<HTMLDialogElement>('provider-dialog');}

 /** Open with sensible defaults: the Ollama address is the common case for a local provider. */
 open():void{
  if(!this.dialog().open){
   this.set('provider-id','');
   this.set('provider-label','');
   this.set('provider-url','http://localhost:11434/v1');
   this.set('provider-key','');
   this.set('provider-model','');
   this.note('A local Ollama server needs no API key.');
   this.dialog().showModal();
   element<HTMLInputElement>('provider-id').focus();
  }
 }
 close():void{if(this.dialog().open)this.dialog().close();}
 private set(id:string,value:string):void{element<HTMLInputElement>(id).value=value;}
 private value(id:string):string{return element<HTMLInputElement>(id).value.trim();}
 private note(text:string,kind:'info'|'error'|'ok'='info'):void{
  const note=element('provider-note');
  note.textContent=text;
  note.classList.toggle('error',kind==='error');
  note.classList.toggle('ok',kind==='ok');
 }
 private draft():ProviderDraft{
  return {id:normalizeProviderId(this.value('provider-id')),label:this.value('provider-label'),
   baseUrl:this.value('provider-url'),apiKey:element<HTMLInputElement>('provider-key').value.trim(),
   defaultModel:this.value('provider-model')};
 }
 private setBusy(busy:boolean):void{
  this.busy=busy;
  for(const id of ['provider-save','provider-test','provider-cancel','provider-close'])
   (element(id) as HTMLButtonElement).disabled=busy;
 }

 private save():void{
  if(this.busy)return;
  const draft=this.draft();
  const errors=providerDraftErrors(draft);
  if(errors.length){this.note(errors[0].message,'error');element<HTMLInputElement>(`provider-${errors[0].field}`)?.focus();return;}
  this.setBusy(true);
  this.note('Saving to Hermes…');
  this.post({type:'providerSave',...draft});
 }

 private test():void{
  if(this.busy)return;
  const baseUrl=this.value('provider-url');
  if(!baseUrl){this.note('Enter the endpoint base URL first','error');return;}
  this.setBusy(true);
  this.note('Probing the endpoint…');
  this.post({type:'providerTest',baseUrl,apiKey:element<HTMLInputElement>('provider-key').value.trim()});
 }

 /** The host's reply to a save: report it, clear the key, and close on success. */
 saved(result:ProviderSaveResult):void{
  this.setBusy(false);
  element<HTMLInputElement>('provider-key').value='';
  if(result.warning)this.note(`${result.warning} The provider is saved; check the URL or start the server.`,'error');
  else this.note(`Saved. ${describeProvider(result)}`,'ok');
  if(!result.warning)this.close();
 }

 /** The host's reply to a Test: models found, or the endpoint's own error. */
 tested(result:{ok:boolean;models?:string[];count?:number;error?:string}):void{
  this.setBusy(false);
  if(result.ok){
   const names=(result.models??[]).slice(0,4).join(', ');
   this.note(`Endpoint answered: ${result.count??0} model${result.count===1?'':'s'}${names?` (${names}${(result.count??0)>4?'…':''})`:''}.`,'ok');
  }else{
   this.note(`Endpoint did not answer: ${result.error??'unknown error'}`,'error');
  }
 }
}
