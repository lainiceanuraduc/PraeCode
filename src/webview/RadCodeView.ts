import {applyAppearance, setCustomFont} from './appearance';
import {element} from './dom';
import {TranscriptView} from './TranscriptView';
import {AgentMenu} from './AgentMenu';
import {ContextAttachments} from './ContextAttachments';
import {PastedImages} from './PastedImages';
import {ApprovalCards} from './ApprovalCards';
import {IMAGE_MIME} from '../domain/Images';
import type {ContextUsage, PermissionRequest, PastedImage, AttachmentRef, ViewState} from './types';
import type {ConversationSession} from '../application/SessionController';

declare function acquireVsCodeApi():{postMessage(message:unknown):void;getState():any;setState(state:unknown):void};

export class RadCodeView {
 private api=acquireVsCodeApi();private transcript=new TranscriptView();
 private state:ViewState={sessions:[],activeId:'',presets:[],recent:[]};
 private agents=new AgentMenu((m:any)=>this.post(m));
 private context=new ContextAttachments((m:any)=>this.post(m));
 private images=new PastedImages((m:any)=>this.post(m),()=>{
  const active=this.state.sessions.find(s=>s.id===this.state.activeId);
  return !!active?.acceptsImages;
 });
 private approvals=new ApprovalCards((m:any)=>this.post(m));
 private pendingImages:PastedImage[]=[];
 constructor(){
  const saved=this.api.getState()??{};element<HTMLTextAreaElement>('message').value=saved.draft??'';
  for(const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]')){
   tab.onclick=()=>this.tab(tab.dataset.tab!);
   tab.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab]'));const i=tabs.indexOf(tab);const next=e.key==='Home'?tabs[0]:e.key==='End'?tabs.at(-1)!:tabs[(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length];next.focus();this.tab(next.dataset.tab!);};
  }
  for(const id of ['connect','new'])element(id).onclick=()=>this.post({type:'new'});
  element('settings').onclick=()=>this.post({type:'settings'});
  element('logs').onclick=()=>this.post({type:'logs'});
  element('model').onclick=()=>this.post({type:'model',id:this.state.activeId});
  element('history').onclick=()=>this.post({type:'history'});
  element('rename').onclick=()=>this.beginRename();
  element('rename-input').onkeydown=e=>{
   if(e.key==='Enter'){e.preventDefault();this.commitRename();}
   else if(e.key==='Escape'){e.preventDefault();this.endRename();}
  };
  element('rename-input').addEventListener('blur',()=>this.commitRename());
  element('stop').onclick=()=>this.post({type:'cancel',id:this.state.activeId});
  element('dismiss-error').onclick=()=>{element('error').hidden=true;};
  element('sessions').onchange=()=>this.post({type:'select',id:element<HTMLSelectElement>('sessions').value});
  element('effort').onchange=()=>this.post({type:'effort',id:this.state.activeId,value:element<HTMLSelectElement>('effort').value});
  // Approvals were previously a dead label; this is the ACP mode switch (Default/Accept Edits/Don't Ask).
  element('mode').onchange=()=>{
   const value=element<HTMLSelectElement>('mode').value;
   if(value)this.post({type:'mode',id:this.state.activeId,value});
  };
  element('show-thinking').onchange=()=>this.render();
  // Text size: apply locally at once (the CSS variables are all derived from --ui-size) and let the
  // host persist it into radcode.fontSize so it survives a reload.
  const size=element<HTMLInputElement>('text-size');
  size.oninput=()=>{
   const value=Math.min(20,Math.max(10,Number(size.value)||16));
   element('text-size-value').textContent=String(value);
   this.applyFontSize(value);
   this.post({type:'textSize',value});
  };
  element('composer').onsubmit=e=>{e.preventDefault();this.send();};
  // Paste an image anywhere in the composer textarea: bytes stay here, the host re-validates them.
  element('message').addEventListener('paste',e=>{
   const files=Array.from(e.clipboardData?.files??[]).filter(f=>IMAGE_MIME[f.type]);
   if(!files.length)return;
   e.preventDefault();
   this.images.addFiles(files);
  });
  element('message').addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});
  element('message').addEventListener('drop',e=>{
   const files=Array.from(e.dataTransfer?.files??[]).filter(f=>IMAGE_MIME[f.type]);
   if(!files.length)return;
   e.preventDefault();this.images.addFiles(files);
  });
  element('compact').onclick=()=>this.compact();
  element('screenshot').onclick=()=>this.post({type:'screenshot'});
  element('message').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();this.send();}};
  element('message').oninput=()=>this.api.setState({draft:element<HTMLTextAreaElement>('message').value});
  document.addEventListener('click',e=>{
   const target=(e.target as Element).closest('a');if(target){e.preventDefault();this.post({type:'link',url:target.getAttribute('href')});}
   const doc=(e.target as Element).closest<HTMLElement>('[data-doc]');if(doc)this.post({type:'link',url:'https://hermes-agent.nousresearch.com/docs/'+doc.dataset.doc});
  });
  window.addEventListener('message',e=>this.receive(e.data));this.post({type:'ready'});
 }
 private post(message:any):void{this.api.postMessage(message);}
 /** Apply a base font size immediately (the slider must respond before the host round-trip). */
 private applyFontSize(value:number):void{
  document.documentElement.style.setProperty('--ui-size',`${value}px`);
  if(this.state.appearance)this.state.appearance.fontSize=value;
 }
 /** Inline rename: the picker is replaced by an input prefilled with the current name. */
 private beginRename():void{
  const active=this.state.sessions.find(s=>s.id===this.state.activeId);
  if(!active){this.showError('Create or select a conversation first');return;}
  const input=element<HTMLInputElement>('rename-input');
  input.value=active.title;
  element('sessions').hidden=true;element('rename').hidden=true;input.hidden=false;
  input.focus();input.select();
 }
 private endRename():void{
  const input=element<HTMLInputElement>('rename-input');input.hidden=true;input.value='';
  element('sessions').hidden=false;element('rename').hidden=false;
 }
 private commitRename():void{
  const input=element<HTMLInputElement>('rename-input');
  if(input.hidden)return;
  const active=this.state.sessions.find(s=>s.id===this.state.activeId);
  const title=input.value.replace(/\s+/g,' ').trim();
  this.endRename();
  if(!active||!title||title===active.title)return;
  // Optimistic: the host pushes authoritative state, and reverts by re-publishing on failure.
  active.title=title;this.render();
  this.post({type:'rename',id:active.id,title});
 }
 private tab(name:string):void{
  for(const section of ['chat','agents','features']){element(section).hidden=section!==name;const b=element('tab-'+section);b.setAttribute('aria-selected',String(section===name));b.tabIndex=section===name?0:-1;}
 }
 private send():void{
  const input=element<HTMLTextAreaElement>('message');const active=this.state.sessions.find(s=>s.id===this.state.activeId);
  const attachments=this.context.list();const images=this.images.list();
  if((!input.value.trim()&&!attachments.length&&!images.length)||!active||['running','configuring','cancelling','disconnected'].includes(active.status))return;
  const text=input.value;
  // Clear immediately so the composer never shows text that is already in flight. If the host
  // rejects admission, the `error` reply restores exactly this draft, its attachments and images.
  this.clear();this.pending=attachments;this.pendingImages=images;this.context.clear();this.images.clear();
  this.post({type:'send',id:active.id,text,attachments,images:images.map((i:{data:string;mime:string;name:string})=>({data:i.data,mime:i.mime,name:i.name}))});
 }
 private clear():void{element<HTMLTextAreaElement>('message').value='';this.api.setState({draft:''});}
 private pending:AttachmentRef[]=[];
 private showError(text:string,draft?:string):void{
  element('error-text').textContent=text;element('error').hidden=false;
  // Restore a rejected draft only into an empty composer; never overwrite what the user retyped.
  if(draft===undefined)return;
  const input=element<HTMLTextAreaElement>('message');
  if(input.value)return;
  input.value=draft;this.api.setState({draft});
 }
 private receive(message:any):void{
  if(message.type==='state'){
   if(message.activeId!==this.state.activeId){this.context.clear();this.images.clear();this.pending=[];this.pendingImages=[];}
   this.state=message;applyAppearance(message.appearance);
   if(!message.sessions.some((s:ConversationSession)=>s.id===this.state.activeId))this.endRename();
   this.render();this.context.syncEditor(message.editor);
  }
  else if(message.type==='error'){
   // A rejected send never loses work: restore the exact draft and its attachments.
   if(this.pending.length){for(const item of this.pending)this.context.add(item);this.pending=[];}
   if(this.pendingImages.length){this.images.restore(this.pendingImages);this.pendingImages=[];}
   this.showError(message.message,typeof message.draft==='string'?message.draft:undefined);
  }
  else if(message.type==='files')this.context.files(message.paths,message.query);
  else if(message.type==='image'){this.images.add(String(message.data??''),String(message.mime??'image/png'),String(message.name??'screenshot.png'));this.tab('chat');}
  else if(message.type==='permission')this.approvals.add(message as PermissionRequest);
  else if(message.type==='permissionSettled')this.approvals.settle(String(message.requestId));
  else if(message.type==='compacted'){
   element('error-text').textContent=message.compressed
    ?`Compacted ${message.before??'?'} → ${message.after??'?'} messages`
    :'Nothing to compact yet';
   element('error').hidden=false;element('error').classList.add('info');
  }
  else if(message.type==='fontCustom'){setCustomFont(String(message.value??''));applyAppearance(this.state.appearance);}
  else if(message.type==='sent'){const input=element<HTMLTextAreaElement>('message');if(input.value===message.text)this.clear();}
  else if(message.type==='draft'){const input=element<HTMLTextAreaElement>('message');input.value+=(input.value?'\n\n':'')+message.text;this.api.setState({draft:input.value});this.tab('chat');input.focus();}
  else if(message.type==='showChat')this.tab('chat');
  else if(message.type==='presetSaved')this.agents.saved();
  else if(message.type==='catalog')this.agents.capabilities(message.values,message.note,message.provider,message.model);
 }
 /**
  * Context indicator. Numbers come from Hermes (`session.info` via the bridge); when it reports
  * nothing the meter says so instead of showing a made-up percentage.
  */
 private renderContext(info:any):void{
  const meter=element('context-meter');const usage:ContextUsage|undefined=info?.context;
  const hasNumbers=typeof usage?.used==='number'||typeof info?.messages==='number';
  meter.hidden=!info||!hasNumbers;
  const compact=element<HTMLButtonElement>('compact');
  compact.disabled=!info||['running','configuring','cancelling','disconnected'].includes(this.state.sessions.find(s=>s.id===this.state.activeId)?.status??'');
  if(!info)return;
  const used=typeof usage?.used==='number'?usage.used:null;
  const limit=typeof usage?.limit==='number'&&usage.limit>0?usage.limit:null;
  const ratio=used!==null&&limit?Math.min(1,used/limit):null;
  const bar=element('context-bar');
  const fill=element('context-fill');
  fill.style.width=`${ratio===null?0:Math.round(ratio*100)}%`;
  bar.setAttribute('aria-valuenow',String(ratio===null?0:Math.round(ratio*100)));
  bar.classList.toggle('warn',ratio!==null&&ratio>=0.75);
  bar.classList.toggle('critical',ratio!==null&&ratio>=0.9);
  const parts:string[]=[];
  if(used!==null&&limit)parts.push(`${Math.round(ratio!*100)}% of ${Math.round(limit/1000)}k`);
  else if(used!==null)parts.push(`${Math.round(used/1000)}k tokens`);
  else parts.push('context size unknown');
  const messages=usage?.messages??info.messages??0;
  if(messages)parts.push(`${messages} msgs`);
  // Kept short: the status line is narrow, and truncation mid-word reads as a bug.
  if(usage?.compactions)parts.push(`${usage.compactions}× compacted`);
  element('context-text').textContent=parts.join(' · ');
  bar.title=used!==null&&limit?`${used} of ${limit} context tokens used`:'Hermes did not report a context window for this model';
 }
 private async compact():Promise<void>{
  const active=this.state.sessions.find(s=>s.id===this.state.activeId);
  if(!active)return;
  this.post({type:'compact',id:active.id,focus:''});
 }

 /**
  * The text-size control sits under the context meter: a range input bound to radcode.fontSize.
  * It is hidden until there is a conversation, so the welcome screen stays uncluttered.
  */
 private renderTextSize(visible:boolean):void{
  const row=element('text-size-row');
  row.hidden=!visible;
  if(!visible)return;
  const size=element<HTMLInputElement>('text-size');
  const current=Math.round(Number(this.state.appearance?.fontSize)||16);
  if(Number(size.value)!==current)size.value=String(current);
  element('text-size-value').textContent=String(current);
 }

 /**
  * The approval control is the ACP mode list Hermes advertises (Default = ask, Accept Edits,
  * Don't Ask). Hidden when the agent reports no modes, rather than offering a control that cannot work.
  */
 private renderModes(active:ConversationSession|undefined):void{
  const select=element<HTMLSelectElement>('mode');
  const modes=active?.modes;
  if(!active||!modes||!modes.available.length){select.hidden=true;return;}
  select.hidden=false;
  const signature=modes.available.map(m=>m.id).join(',');
  if(select.dataset.signature!==signature){
   select.replaceChildren();
   for(const mode of modes.available){
    const option=new Option(mode.name,mode.id);
    if(mode.description)option.title=mode.description;
    select.add(option);
   }
   select.dataset.signature=signature;
  }
  select.value=modes.current||modes.available[0].id;
  const busy=!!active&&['running','configuring','cancelling'].includes(active.status);
  select.disabled=busy;
  const current=modes.available.find(m=>m.id===modes.current);
  select.title=current?.description??'When Hermes must ask before editing files';
 }

 private render():void{
  const active=this.state.sessions.find(s=>s.id===this.state.activeId);
  const busy=!!active&&['running','configuring','cancelling'].includes(active.status);
  const select=element<HTMLSelectElement>('sessions');select.replaceChildren();
  for(const s of this.state.sessions)select.add(new Option(`${s.kind==='worker'?'Worker · ':''}${s.title}`,s.id));
  if(!this.state.sessions.length)select.add(new Option('No conversation',''));
  select.value=this.state.activeId;
  element('welcome').hidden=!!active;element('route').hidden=!active;
  element('warning').hidden=!active?.warning;element('warning').textContent=active?.warning??'';
  element('model').textContent=active?.info?`${active.info.provider} / ${active.info.model}`:'Model controls unavailable';
  (element('model') as HTMLButtonElement).disabled=!active||busy;
  const effort=element<HTMLSelectElement>('effort');effort.replaceChildren();effort.add(new Option('Profile default','default'));
  for(const value of active?.info?.capabilities.values??[])effort.add(new Option(value==='none'?'None / Off':value,value));
  if(active?.info?.effort && !Array.from(effort.options).some(o=>o.value===active.info!.effort))effort.add(new Option(`${active.info.effort} (current)`,active.info.effort));
  effort.value=active?.info?.effort||'default';effort.disabled=busy||!active?.info?.capabilities.values.length;
  element('effort-note').textContent=active?.info?.capabilities.note??'Session controls need a compatible local Hermes runtime.';
  element('status').textContent=active?active.status:'Not connected';
  // The spinner mirrors the turn state: running/starting animate, everything else rests.
  const spinner=element<HTMLElement>('status')?.previousElementSibling as HTMLElement|null;
  if(spinner&&spinner.classList.contains('status-spinner'))
   spinner.dataset.state=active?active.status:'idle';
  // Keep the visible session title in sync with the active conversation.
  const titleElement=element('session-title') as HTMLElement|null;
  if(titleElement)titleElement.textContent=active?.title??'';
  this.renderModes(active);
  // Stop stays on screen so the control does not appear and vanish mid-turn; it is disabled
  // whenever there is nothing to cancel.
  (element('stop') as HTMLButtonElement).disabled=active?.status!=='running';
  (element('rename') as HTMLButtonElement).disabled=!active||busy;
  (element('send') as HTMLButtonElement).disabled=!active||busy||active.status==='disconnected';
  this.renderContext(active?.info);
  this.renderTextSize(active!==undefined);
  this.transcript.render(active,element<HTMLInputElement>('show-thinking').checked);this.agents.render(this.state);
 }
}
new RadCodeView();
