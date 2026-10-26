import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {AgentPreset} from '../domain/PresetRepository';
import {clampEffort} from '../domain/EffortLadder';
import {Attachment, composePrompt} from '../domain/Attachments';
import type {ImageAttachment} from '../domain/Images';
import type {SessionControl, SessionInfo} from '../infrastructure/HermesControl';

export interface AgentClient extends EventEmitter {
 readonly acceptsImages:boolean;
 connect():Promise<any>; newSession(cwd:string,mcpServers?:unknown[]):Promise<any>;
 loadSession(id:string,cwd:string,mcpServers?:unknown[]):Promise<any>;
 prompt(id:string,blocks:string|unknown[]):Promise<any>; cancel(id:string):void; dispose():void;
 setMode(id:string,modeId:string):Promise<any>;
 /** ACP `session/set_model`; `modelId` is provider-qualified with a colon. */
 setModel(id:string,modelId:string):Promise<any>;
}
export interface Message {
 id:string; role:'user'|'assistant'|'thinking'|'tool'|'notice';text:string;
 status?:string;title?:string;
 /** Wall-clock time the message (or its first chunk) arrived, for the transcript's time labels. */
 at:number;
 attachments?:{name:string;line?:number;size:number}[];
}
export type SessionStatus='idle'|'configuring'|'running'|'cancelling'|'cancelled'|'failed'|'disconnected';
export class ConversationSession {
 readonly messages:Message[]=[];
 /** Whether this session's agent accepts image blocks; false disables pasting in the composer. */
 acceptsImages=false;
 /** Context telemetry for the meter: from the live `usage_update` stream, else from `session.info`. */
 context?:{used:number|null;limit:number|null;messages:number;compactions:number;source:'stream'|'session'|'catalog'};
 status:SessionStatus='idle';info?:SessionInfo;warning='';models:any[]=[];commands:any[]=[];usage:any;
 /** ACP modes: the edit-approval policy (ask / workspace_session / session) plus display names. */
 modes:{available:{id:string;name:string;description?:string}[];current:string}={available:[],current:''};
 constructor(public id:string, public title:string, public kind:'chat'|'worker', public cwd:string){}
 get busy():boolean{return ['configuring','running','cancelling'].includes(this.status);}
 /** `wire` is what the provider sees; the transcript shows `text` plus an attachment list. */
 /**
  * Append a chunk, merging into the previous message when it is the same flowing role.
  *
  * Streaming roles (`assistant`, `thinking`) arrive as many small chunks; merging keeps one entry per
  * logical message instead of hundreds. The merge is deliberately *adjacency*-based (the previous
  * entry), never a search for "the last message of this role": interleaved reasoning and tool
  * activity must keep their real order, which is what the transcript's time labels render.
  */
 append(role:Message['role'],text:string,attachments?:Message['attachments']):void {
  if(!text)return;
  const last=this.messages.at(-1);
  const streamy=role==='assistant'||role==='thinking';
  if(last&&streamy&&last.role===role){
   last.text=(last.text+text).slice(-400_000);
  }else{
   this.messages.push(attachments?.length
    ?{id:randomUUID(),role,text:text.slice(-400_000),at:Date.now(),attachments}
    :{id:randomUUID(),role,text:text.slice(-400_000),at:Date.now()});
  }
  if(this.messages.length>250)this.messages.splice(0,this.messages.length-250);
 }
 update(update:any):void {
  const kind=update?.sessionUpdate;
  if(kind==='agent_message_chunk'||kind==='agent_thought_chunk'||kind==='user_message_chunk') {
   this.append(kind==='agent_thought_chunk'?'thinking':kind==='user_message_chunk'?'user':'assistant',update.content?.type==='text'?update.content.text:'');
  } else if(kind==='tool_call'||kind==='tool_call_update') {
   let row=this.messages.find(m=>m.id===update.toolCallId);
   // First sight of this tool call: it starts *now*, in arrival order, between whatever reasoning
   // and assistant text surrounded it — exactly where the transcript will show it.
   if(!row){row={id:update.toolCallId,role:'tool',text:'',title:'Tool',at:Date.now()};this.messages.push(row);}
   if(update.title)row.title=update.title;
   if(update.status)row.status=update.status;
   if(update.content)row.text=update.content.map((c:any)=>c.type==='content'?c.content?.text??'':c.type==='diff'?`File: ${c.path}\n--- Before\n${c.oldText??''}\n+++ After\n${c.newText??''}`:JSON.stringify(c)).join('\n').slice(-100_000);
   else if(update.rawInput)row.text=JSON.stringify(update.rawInput,null,2).slice(-100_000);
  } else if(kind==='available_commands_update')this.commands=update.availableCommands??[];
  else if(kind==='usage_update'){
   // `size` is the context window, `used` its current occupancy — the same numbers Zed shows.
   this.usage=update;
   const size=Number(update.size),used=Number(update.used);
   if(Number.isFinite(size)&&size>0)this.context={
    used:Number.isFinite(used)?Math.max(0,used):null,limit:size,
    messages:this.context?.messages??0,compactions:this.context?.compactions??0,source:'stream'};
  }
 }
}

/** Application service: serializes controls per session, not across independent workers. */
export class SessionController extends EventEmitter {
 readonly sessions:ConversationSession[]=[];
 activeId=''; private startingWorkers=0; private disposed=false;
 constructor(private client:AgentClient,readonly control:SessionControl,private cwd:()=>string,private maxWorkers:()=>number){
  super();
  client.on('update',({sessionId,update})=>{
   const session=this.sessions.find(s=>s.id===sessionId);if(!session)return;
   session.update(update);this.changed();
  });
  client.on('closed',(message:string)=>{
   for(const session of this.sessions){session.status='disconnected';session.warning=message;}
   this.changed();
  });
 }
 async listSaved(){return this.control.sessions(this.cwd());}
 /** Hermes' own delegation policy + child runs for this workspace, straight from the bridge. */
 async delegation(){return this.control.subagents(this.cwd());}
 get active():ConversationSession|undefined{return this.sessions.find(s=>s.id===this.activeId);}
 /** Context usage for one session, preferring the live stream over a static inspect. */
 usage(id:string):ConversationSession['context']{
  const s=this.sessions.find(s=>s.id===id);
  return s?.context??undefined;
 }
 get(id:string):ConversationSession {const s=this.sessions.find(s=>s.id===id);if(!s)throw new Error('Session not found');return s;}
 select(id:string):void {this.get(id);this.activeId=id;this.changed();}
 private changed():void {this.emit('changed');}
 private requireIdle(s:ConversationSession):void {if(s.busy)throw new Error('Session is busy');if(s.status==='disconnected')throw new Error('Session disconnected; resume it first');}
 async create(kind:'chat'|'worker'='chat',title='New conversation'):Promise<ConversationSession>{
  if(this.disposed)throw new Error('Extension closed');
  const cwd=this.cwd();
  const servers=this.mcpServers();
  const result=await this.client.newSession(cwd,servers);
  const s=new ConversationSession(result.sessionId,title,kind,cwd);
  s.acceptsImages=!!this.client.acceptsImages;
  s.models=result.models?.availableModels??[];
  this.readModes(s,result);
  this.sessions.push(s);this.activeId=s.id;
  await this.refresh(s);
  void this.refreshLadder(s.id);  // ladder is a property of the model: fetch on load
  this.changed();return s;
 }
 async resume(id:string,cwd:string,title:string):Promise<void>{
  let s=this.sessions.find(s=>s.id===id);
  if(s&&s.status!=='disconnected'){this.select(id);return;}
  if(!s){s=new ConversationSession(id,title,'chat',cwd);this.sessions.push(s);}
  const previous=s.messages.slice();
  s.messages.splice(0);s.status='configuring';this.activeId=id;this.changed();
  try{
   const result=await this.client.loadSession(id,cwd,this.mcpServers());
   s.acceptsImages=!!this.client.acceptsImages;
   s.models=result.models?.availableModels??[];
   this.readModes(s,result);
   s.status='idle';await this.refresh(s);
   void this.refreshLadder(s.id);  // and on resume
  }
  catch(e){s.messages.splice(0,s.messages.length,...previous);s.status='disconnected';s.warning=String(e);throw e;}
  finally{this.changed();}
 }
 async refresh(s:ConversationSession):Promise<void>{
  try{this.adoptInfo(s,await this.control.inspect(s.id));s.warning='';}
  catch(e){s.info=undefined;s.warning=String(e);}
 }
 /**
  * The single place a `SessionInfo` becomes session state.
  *
  * Every control that returns session info (inspect, setEffort, setMode) must go through here: the
  * bridge reports flat `contextTokens`/`contextWindow` counters and the live `usage_update` stream is
  * more current than any inspect, so dropping this mapping on one path silently emptied the context
  * meter until the next full refresh.
  */
 private adoptInfo(s:ConversationSession,info:SessionInfo):void{
  const raw=info as SessionInfo & {contextTokens?:number|null;contextWindow?:number|null;compactions?:number};
  const live=s.context?.source==='stream'?s.context:undefined;
  // Never regress to null: a window learned from the model catalog outlives an inspect that omits it.
  info.context={used:live?.used??raw.contextTokens??s.context?.used??null,
                limit:live?.limit??raw.contextWindow??s.context?.limit??null,
                messages:raw.messages??live?.messages??0,
                compactions:raw.compactions??0};
  s.info=info;
 }
 /**
  * `contents` are the attachment bodies read by the host; they travel to the provider but never
  * into the transcript, which shows the attachment names instead.
  */
 async send(id:string,text:string,attachments:Attachment[]=[],contents:string[]=[],
            images:ImageAttachment[]=[]):Promise<void>{
  const s=this.get(id);this.requireIdle(s);
  if(!text.trim()&&!attachments.length&&!images.length)throw new Error('Message must contain 1–200000 characters');
  if(contents.length!==attachments.length)throw new Error('Attachment contents do not match the attachment list');
  if(images.length&&!s.acceptsImages)throw new Error('This session\'s agent does not accept images');
  const wire=attachments.length?composePrompt(text,attachments,contents):text;
  if(!wire.trim()||wire.length>2_000_000)throw new Error('Message must contain 1–200000 characters');
  s.status='running';
  // Images are summarised in the transcript: the base64 never enters the UI state.
  const shown:NonNullable<Message['attachments']>=[];
  for(const a of attachments)shown.push({name:a.name,line:a.line,size:a.size});
  for(const image of images)shown.push({name:image.name,size:image.size});
  s.append('user',text.trim()||`Attached ${shown.length} item(s)`,shown.length?shown:undefined);
  this.changed();
  // ACP blocks: one text block first (keeps slash commands and text-only models working), then images.
  const blocks:unknown[]=[{type:'text',text:wire},
    ...images.map(i=>({type:'image',data:i.data,mimeType:i.mime}))];
  try{
   const result=await this.client.prompt(id,images.length?blocks:wire);
   s.status=result.stopReason==='cancelled'?'cancelled':'idle';
   await this.refresh(s);
  }catch(e){s.status='failed';s.append('notice',String(e));throw e;}  // notice gets a stamp via append
  finally{this.changed();}
 }
 cancel(id:string):void{
  const s=this.get(id);
  if(s.status!=='running')return;
  s.status='cancelling';this.client.cancel(id);this.changed();
 }
 async setEffort(id:string,value:string):Promise<void>{
  const s=this.get(id);this.requireIdle(s);
  if(value!=='default'&&!s.info?.capabilities.values.includes(value))throw new Error(`Unsupported effort for this provider/model. Supported: ${s.info?.capabilities.values.join(', ')||'unknown'}`);
  s.status='configuring';this.changed();
  try{this.adoptInfo(s,await this.control.setEffort(id,value));s.warning='';}
  finally{s.status='idle';this.changed();}
 }
 /**
  * Switch model through ACP's own control (`session/set_model`), not a `/model` prompt.
  *
  * A slash command is a *turn*: it can queue behind a running admission, it echoes into the
  * transcript, and — like `/title` — it is only as reliable as the command router. The protocol call
  * is routed by Hermes without an LLM request, handles guarded models by raising the same permission
  * request the CLI does, and marks the picker's current entry.
  *
  * `modelId` is provider-qualified with a colon (`openrouter:anthropic/claude-sonnet-4.5`) because
  * that is the form Hermes' `parse_model_input` understands; Ollama ids may carry their own colon
  * (`ollama-cloud:deepseek-v4.1-flash:1017`), which the parser splits on the first known provider.
  */
 async setModel(id:string,model:string,provider=''):Promise<void>{
  const s=this.get(id);this.requireIdle(s);
  const clean=model.trim();
  if(!clean||!/^[\w][\w./:@+\-]*$/.test(clean))throw new Error('Invalid model identifier');
  if(provider&&!/^[\w][\w.:\-]*$/.test(provider))throw new Error('Invalid provider identifier');
  // A picker id already carries its provider (`openrouter:...`); only prefix a bare model id.
  const target=provider&&!clean.includes(':')?`${provider}:${clean}`:clean;
  s.status='configuring';this.changed();
  try{
   try{
    await this.client.setModel(id,target);
   }catch(e){
    // A `session/set_model` that timed out may still have landed. Re-read the session instead of
    // re-sending: Hermes cannot say whether the first switch committed, and a blind retry is how a
    // user ends up on a model they never picked. Confirmed → adopt; otherwise refuse and require a
    // reconnect, so the session cannot be used on an assumption.
    if(/timed out|outcome may be unknown/i.test(String(e instanceof Error?e.message:e))){
     let confirmed=false;
     try{await this.refresh(s);confirmed=this.modelMatches(s,clean,target,provider);}catch{}
     if(confirmed){await this.refreshLadder(s.id);return;}
     s.status='disconnected';
     s.warning='The model switch timed out and Hermes did not confirm it. Reconnect (resume this conversation) before trying again.';
     throw new Error(s.warning);
    }
    throw e;
   }
   await this.refresh(s);
   if(!s.info)throw new Error('Could not confirm model selection');
   if(!this.modelMatches(s,clean,target,provider))
    throw new Error(`Model selection not confirmed. Active: ${s.info.provider}/${s.info.model}`);
   // The new model may have a different ladder; refresh before the selector renders it.
   await this.refreshLadder(s.id);
   // `refresh` above already re-inspected the switched session, so s.info.capabilities now describe
   // the NEW model; the selector renders from it on the next publish. No extra request needed.
  }finally{if(s.status==='configuring')s.status='idle';this.changed();}
 }
 /** Whether the session really sits on the requested provider/model after a switch. */
 private modelMatches(s:ConversationSession,clean:string,target:string,provider:string):boolean{
  if(!s.info)return false;
  const modelOk=s.info.model===clean||s.info.model===target||target.endsWith(`:${s.info.model}`);
  return modelOk&&(!provider||s.info.provider===provider);
 }
 /** Adopt the ACP mode list a session reply carries (create/load). Absent = leave the control hidden. */
 private readModes(s:ConversationSession,result:any):void{
  const modes=result?.modes;
  if(!modes)return;
  s.modes={available:Array.isArray(modes.availableModes)?modes.availableModes.map((m:any)=>({
    id:String(m.id),name:String(m.name??m.id),description:m.description?String(m.description):undefined
  })):[],current:String(modes.currentModeId??'')};
 }
 /**
  * Switch the edit-approval mode. Adopted only after Hermes accepts it, then re-read from the
  * session so the dropdown can never show a policy the session does not actually have.
  */
 async setMode(id:string,modeId:string):Promise<void>{
  const s=this.get(id);this.requireIdle(s);
  if(!s.modes.available.some(m=>m.id===modeId))throw new Error(`Unknown approval mode: ${modeId}`);
  if(s.modes.current===modeId)return;
  s.status='configuring';this.changed();
  try{
   await this.client.setMode(id,modeId);
   s.modes.current=modeId;
   await this.refresh(s);
  }finally{s.status='idle';this.changed();}
 }
 async rename(id:string,title:string):Promise<void>{
  const s=this.get(id);
  // A rename is a metadata edit on Hermes, not a conversation action: it needs no ACP turn and no
  // live load, so a session that is disconnected (or was never resumed in this window) can still be
  // renamed. Only a running turn must be left alone.
  if(s.busy)throw new Error('Wait for the current turn to finish before renaming');
  // Collapse whitespace: the title is also a display and export name, never a wire payload.
  const clean=title.replace(/\s+/g,' ').trim();
  if(!clean)throw new Error('Enter a session name');
  if(clean.length>120)throw new Error('Session names are limited to 120 characters');
  if(clean===s.title)return;
  s.status='configuring';this.changed();
  try{
   const result=await this.control.rename(id,clean);
   if(!result.title)throw new Error('Hermes did not confirm the session name');
   s.title=result.title;
   if(this.recent)this.recent(s.id,s.title);
  }finally{s.status='idle';this.changed();}
 }
 /** Rename a conversation that is only in the saved index (never loaded in this window). */
 async renameSaved(id:string,title:string):Promise<string>{
  const clean=title.replace(/\s+/g,' ').trim();
  if(!clean)throw new Error('Enter a session name');
  if(clean.length>120)throw new Error('Session names are limited to 120 characters');
  const result=await this.control.rename(id,clean);
  if(!result.title)throw new Error('Hermes did not confirm the session name');
  if(this.recent)this.recent(id,result.title);
  this.changed();
  return result.title;
 }
 /** Hook for the extension to keep its recent-session list in step with a rename. */
 recent?:(id:string,title:string)=>void;
 /** Configured MCP servers, injected by the extension root; empty means Hermes' own config applies. */
 mcpServers:()=>unknown[]=()=>[];
 /**
  * Fetch the effort ladder for the session's current model and merge it into `info`.
  *
  * The ladder belongs to the model, so it is fetched on load/switch — not lazily on the first effort
  * change, which showed stale capabilities for the whole life of a session. A failure degrades to
  * "unknown" rather than disabling the rest of the controls.
  */
 async refreshLadder(id:string):Promise<void>{
  const s=this.get(id);
  if(!s.info)return;
  try{
   const caps=await this.control.capabilities(s.info.provider,s.info.model,s.info.baseUrl);
   s.info.capabilities=caps;
  }catch(e){
   s.info.capabilities={values:[],note:`Could not read capabilities: ${e instanceof Error?e.message:String(e)}`};
  }
  // `session.info` never reports a context window and `usage_update` only arrives after a turn, so
  // the meter had nothing to show until the first prompt. The model catalog knows the window up
  // front: use it as the denominator, and leave `used` unknown until Hermes reports occupancy.
  try{
   const details=await this.control.modelInfo(s.info.provider,s.info.model,s.info.baseUrl);
   if(details.context&&(!s.info.context||s.info.context.source==='session'||s.info.context.limit===null)){
    s.info.context={used:s.info.context?.used??null,limit:details.context,
     messages:s.info.context?.messages??0,compactions:s.info.context?.compactions??0,source:'catalog'};
   }
  }catch{/* a missing window stays unknown rather than a made-up number */}
  this.changed();
 }
 /**
  * Manual compaction is a fenced `session.mutate compress`, exactly what `/compress` does, so the
  * summary is produced by Hermes and the transcript is rebuilt from its committed snapshot.
  */
 async compact(id:string,focus=''):Promise<{before:number;after:number;nothing?:boolean;warning?:string}>{
  const s=this.get(id);
  // Compaction is Hermes' own mutation on stored rows, so a disconnected session can still be
  // compacted; only a live turn must be left alone.
  if(s.busy)throw new Error('Wait for the current turn to finish before compacting');
  const before=s.messages.length;
  s.status='configuring';this.changed();
  try{
   const result=await this.control.compact(id,focus);
   if(result.compressed===false){
    // Hermes had nothing older than the recent window to summarise; that is not a failure.
    await this.refresh(s).catch(()=>undefined);
    return {before,after:before,nothing:true};
   }
   await this.refresh(s).catch(()=>undefined);
   // Hermes already owns the commit at this point. Re-attaching replays what is left, but a replay
   // failure must never be reported as a failed compaction: the context WAS compacted, and the user
   // would otherwise compact again and again.
   let warning='';
   try{await this.reload(s);}
   catch(error){warning=`Compacted, but the remaining transcript could not be replayed: ${error instanceof Error?error.message:String(error)}`;}
   return {before,after:s.messages.length,warning:warning||undefined};
  }finally{s.status='idle';this.changed();}
 }
 /**
  * Re-read a session's transcript from Hermes.
  *
  * `session/load` does not return messages: it replays the live transcript as `session/update`
  * notifications (archived/compacted rows are filtered out by Hermes), which the `update` listener
  * already appends. So this clears first, then waits for the replay, and restores the previous
  * messages if the load fails.
  */
 private async reload(s:ConversationSession):Promise<void>{
  const previous=s.messages.slice();
  s.messages.splice(0);
  try{
   const result=await this.client.loadSession(s.id,s.cwd,this.mcpServers());
   s.models=result.models?.availableModels??[];
   this.readModes(s,result);
  }catch(e){
   s.messages.push(...previous);
   throw new Error(`Session reload failed after the change: ${e instanceof Error?e.message:String(e)}`);
  }
 }
 async runWorker(preset:AgentPreset,task:string):Promise<void>{
  if(!task.trim()||task.length>100_000)throw new Error('Enter a worker task (maximum 100000 characters)');
  const busy=this.sessions.filter(s=>s.kind==='worker'&&s.busy).length;
  if(busy+this.startingWorkers>=this.maxWorkers())throw new Error('Parallel worker limit reached; wait or stop a worker');
  this.startingWorkers++;
  let reserved=true;
  let s:ConversationSession|undefined;
  try{
   s=await this.create('worker',preset.name);
   if(preset.model)await this.setModel(s.id,preset.model,preset.provider);
   else if(preset.provider)throw new Error('Choose a model when specifying a provider');
   if(preset.effort!=='default'){
    // Presets are portable across routes; clamp onto what this session's provider/model really accepts
    // (Mistral native has only none/high, Ollama Cloud has none..high).
    await this.setEffort(s.id,clampEffort(preset.effort,s.info?.capabilities.values??[]));
   }
   // Transition reservation to running synchronously (send sets status before its first await).
   const completion=this.send(s.id,`Worker: ${preset.name}\n\nInstructions:\n${preset.instructions||'Complete the assigned task.'}\n\nTask:\n${task}`);
   this.startingWorkers--;reserved=false;await completion;
  }catch(e){if(s){s.status='failed';s.append('notice',String(e));}throw e;}
  finally{
   if(reserved)this.startingWorkers--;
   this.changed();
  }
 }
 result(id:string):string {return this.get(id).messages.filter(m=>m.role==='assistant').map(m=>m.text).join('\n\n');}
 dispose():void{
  this.disposed=true;
  for(const s of this.sessions)if(s.status==='running'||s.status==='cancelling'){try{this.client.cancel(s.id);}catch{}}
  this.client.dispose();this.removeAllListeners();
 }
}
