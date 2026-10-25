/**
 * @module RadCodeExtension
 * Composition root: the only place that knows about *both* VS Code and the Hermes-facing services.
 *
 * Layering rule for this extension: domain/application/infrastructure never import `vscode`; the
 * webview never touches Node. This class wires those sides together and owns nothing that a module
 * beside it already owns (settings validation, attachment reading, approvals, screenshots).
 */
import * as vscode from 'vscode';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';

import {AcpClient} from '../infrastructure/AcpClient';
import {HermesControl} from '../infrastructure/HermesControl';
import {SessionController} from '../application/SessionController';
import {PresetRepository} from '../domain/PresetRepository';
import {ChatViewProvider} from '../presentation/ChatViewProvider';
import {webviewMessageError} from '../domain/MessageLimits';

import {mcpServers,appearance,clampTextSize} from './Settings';
import {readProfile,saveProfile} from './ProfileStore';
import {toggleFavorite} from '../domain/ModelCatalog';
import {editorContext,readAttachments,readImages} from './Inputs';
import {PermissionBroker} from './PermissionBroker';
import {captureScreenshot} from './screenshot';

/** A conversation this workspace has used, remembered for the resume picker. */
import {mergeRecent, type RecentSession} from '../domain/RecentSessions';

export class RadCodeExtension implements vscode.Disposable {
 readonly view:ChatViewProvider;
 readonly presets:PresetRepository;
 private readonly permissions:PermissionBroker;
 private service?:SessionController;
 private readonly output:vscode.OutputChannel;
 private readonly disposables:vscode.Disposable[]=[];
 private renderTimer?:NodeJS.Timeout;
 private recentSignature='';
 private creation?:Promise<void>;
 private profile='';
 private restoring?:Promise<void>;
 private restored=false;

 constructor(private readonly context:vscode.ExtensionContext){
  this.output=vscode.window.createOutputChannel('PraeCode Hermes');
  this.presets=new PresetRepository(context.globalState);
  this.view=new ChatViewProvider(context.extensionUri);
  this.permissions=new PermissionBroker(this.view,()=>this.service?.sessions??[],
   text=>this.output.appendLine(redact(text)));
  this.view.onMessage=m=>this.handle(m);

  this.disposables.push(
   this.output,
   this.view,
   vscode.window.registerWebviewViewProvider('radcode.chat',this.view,{webviewOptions:{retainContextWhenHidden:true}}));

  this.profile=this.profileHome();
  this.registerCommands();
  this.watchEnvironment();
  this.publish();
 }

 // ------------------------------------------------------------------ commands

 /** Every command goes through one error boundary so a failure always reaches the user visibly. */
 private registerCommands():void{
  const commands:Record<string,()=>unknown>={
   'radcode.open':()=>this.view.open(),
   'radcode.newSession':()=>this.newSession(),
   'radcode.renameSession':()=>this.renameActive(),
   'radcode.compact':()=>this.compactActive(),
   'radcode.screenshot':()=>captureScreenshot(this.view,()=>this.trusted()),
   'radcode.mcp':()=>this.openMcpSettings(),
   'radcode.attachSelection':()=>this.attachSelection(),
   'radcode.model':()=>this.openModelPicker(),
   'radcode.settings':()=>vscode.commands.executeCommand('workbench.action.openSettings','@ext:lainiceanuraduc.praecode'),
   'radcode.logs':()=>this.output.show(true)
  };
  for(const [name,handler]of Object.entries(commands)){
   this.disposables.push(vscode.commands.registerCommand(name,async()=>{
    try{return await handler();}catch(e){this.report(e);throw e;}
   }));
  }
 }

 /** Editor/file changes drive the context chip, so the view mirrors what the user is looking at. */
 private watchEnvironment():void{
  const mirror=()=>this.publish();
  this.disposables.push(
   vscode.window.onDidChangeActiveTextEditor(mirror),
   vscode.window.onDidChangeTextEditorSelection(e=>{if(e.textEditor===vscode.window.activeTextEditor)this.publish();}),
   vscode.workspace.onDidOpenTextDocument(mirror),
   vscode.workspace.onDidCloseTextDocument(mirror));
  this.disposables.push(vscode.workspace.onDidChangeConfiguration(e=>{
   const live=['radcode.accent','radcode.fontSize',
               'radcode.lineHeight','radcode.compact','radcode.mcpServers','radcode.maxParallelAgents'];
   if(live.some(key=>e.affectsConfiguration(key)))this.publish();
   if(['radcode.hermesPath','radcode.hermesHome','radcode.pythonPath'].some(k=>e.affectsConfiguration(k))){
    // These are baked into the spawn environment, so only a reload can apply them.
    void vscode.window.showInformationMessage(
     'Reload the window to use the new Hermes runtime/profile. Existing sessions keep their current connection.',
     'Reload').then(choice=>{if(choice)void vscode.commands.executeCommand('workbench.action.reloadWindow');});
   }
  }));
 }

 // ------------------------------------------------------------------ guard rails

 private trusted():void{if(!vscode.workspace.isTrusted)throw new Error('Trust this workspace before running Hermes tools.');}

 /** Hermes runs tools in a real folder; a single-file or remote window has nothing to run them in. */
 private cwd():string{
  const editor=vscode.window.activeTextEditor;
  const folder=(editor&&vscode.workspace.getWorkspaceFolder(editor.document.uri))||vscode.workspace.workspaceFolders?.[0];
  if(!folder||folder.uri.scheme!=='file')throw new Error('Open a local project folder before connecting to Hermes.');
  return folder.uri.fsPath;
 }

 // ------------------------------------------------------------------ services

 /**
  * Lazily build the Hermes connection.
  *
  * Deferred on purpose: the view must render (and settings must apply) before Hermes is even probed,
  * so a missing or broken install shows a readable error instead of failing activation.
  */
 get controller():SessionController{
  this.trusted();
  if(this.service)return this.service;
  const config=vscode.workspace.getConfiguration('radcode');
  let executable=config.get<string>('hermesPath','hermes');
  const local=path.join(homedir(),'.local','bin','hermes');
  if(executable==='hermes'&&existsSync(local))executable=local;
  const home=config.get<string>('hermesHome','')||process.env.HERMES_HOME||'';
  if(home&&!path.isAbsolute(home))throw new Error('radcode.hermesHome must be an absolute path to an existing profile.');
  this.profile=home||path.join(homedir(),'.hermes');

  const client=new AcpClient({executable,cwd:this.cwd(),home});
  client.permission=params=>this.permissions.request(params);
  client.on('diagnostic',text=>this.output.append(redact(String(text))));
  const control=new HermesControl(executable,this.context.asAbsolutePath('bridge/control.py'),home,
                                  config.get<string>('pythonPath')||undefined);
  this.service=new SessionController(client,control,()=>this.cwd(),
   ()=>vscode.workspace.getConfiguration('radcode').get<number>('maxParallelAgents',2));

  // Hooks the controller cannot own: which MCP servers a new session gets, and the recent list.
  this.service.mcpServers=()=>mcpServers();
  this.service.recent=(id,title)=>this.rememberTitle(id,title);
  this.service.on('changed',()=>{
   // Coalesce bursts of session updates into one state push.
   if(!this.renderTimer)this.renderTimer=setTimeout(()=>{this.renderTimer=undefined;this.publish();},60);
  });
  return this.service;
 }

 /** Keep the resume picker's copy of a renamed conversation in step. */
 private rememberTitle(id:string,title:string):void{
  const recent=this.context.workspaceState.get<RecentSession[]>('recentSessions',[]);
  const entry=recent.find(r=>r.id===id&&r.profile===this.profile);
  if(!entry||entry.title===title)return;
  entry.title=title;
  void this.context.workspaceState.update('recentSessions',recent);
  this.recentSignature='';
 }

 // ------------------------------------------------------------------ state → webview

 private publish():void{
  const sessions=this.service?.sessions??[];
  if(this.service?.activeId)void this.context.workspaceState.update('activeSession',this.service.activeId);
  const activeId=this.service?.activeId??'';

  // Recent conversations: live ones first, then remembered ones this workspace has seen.
  const recent=this.context.workspaceState.get<RecentSession[]>('recentSessions',[]);
  const added=sessions.map(s=>({id:s.id,title:s.title,cwd:s.cwd,profile:this.profile}));
  for(const entry of recent){
   if(entry.profile!==this.profile)continue;
   const live=sessions.find(s=>s.id===entry.id);
   if(live)entry.title=live.title;
  }
  const combined=mergeRecent(recent,added);
  const signature=JSON.stringify(combined);
  if(signature!==this.recentSignature){
   this.recentSignature=signature;
   void this.context.workspaceState.update('recentSessions',combined);
  }

  // The live `usage_update` stream is fresher than any inspect, so it wins over the cached info.
  const usage=this.service?.usage(activeId);
  if(usage&&sessions.length){
   const active=sessions.find(s=>s.id===activeId);
   if(active?.info)active.info.context={...usage};
  }

  this.view.stateChanged({type:'state',sessions,activeId,presets:this.presets.list(),recent:combined.filter(s=>s.profile===this.profile),
   maxWorkers:vscode.workspace.getConfiguration('radcode').get('maxParallelAgents',2),
   editor:editorContext(),appearance:appearance(this.context.globalState.get<number>('radcode.textSize'))});
 }

 /** Restore the index from Hermes' on-disk catalog, then attach the last conversation. */
 private async restoreSessions():Promise<void>{
  if(this.restored||!vscode.workspace.isTrusted||!vscode.workspace.workspaceFolders?.length)return;
  if(this.restoring)return this.restoring;
  this.restoring=(async()=>{
   const controller=this.controller;
   const previous=this.context.workspaceState.get<RecentSession[]>('recentSessions',[]);
   let discovered:RecentSession[]=[];
   try{discovered=(await controller.listSaved()).map(s=>({id:s.id,cwd:s.cwd,title:s.title||'Saved conversation',profile:this.profile}));}
   catch(error){this.output.appendLine(`Session catalog unavailable; keeping saved history: ${String(error)}`);}
   const combined=mergeRecent(previous,discovered);
   await this.context.workspaceState.update('recentSessions',combined);
   const candidates=combined.filter(s=>s.profile===this.profile&&s.cwd===this.cwd());
   const last=this.context.workspaceState.get<string>('activeSession','');
   const active=candidates.find(s=>s.id===last)??candidates.find(s=>s.id===discovered[0]?.id)??candidates.at(-1);
   this.restored=true;
   if(active&&!controller.activeId){
    try{await controller.resume(active.id,active.cwd,active.title);}
    catch(error){this.view.post({type:'error',message:`Saved conversation could not be resumed. Its history has been kept: ${String(error)}`});}
   }
   this.publish();
  })().finally(()=>{this.restoring=undefined;});
  return this.restoring;
 }

 // ------------------------------------------------------------------ conversations

 async newSession():Promise<void>{
  if(this.creation)return this.creation;
  this.creation=(async()=>{
   await this.view.open();
   await this.controller.create();
   this.publish();
   this.view.post({type:'showChat'});
  })().finally(()=>{this.creation=undefined;});
  return this.creation;
 }

 private async history():Promise<void>{
  const controller=this.controller;
  const recent=this.context.workspaceState.get<RecentSession[]>('recentSessions',[])
   .filter(r=>r.profile===this.profile);
  const pick=await vscode.window.showQuickPick(
   recent.map(s=>({label:s.title,description:s.id,detail:s.cwd,session:s})),
   {title:'Resume a RadCode conversation',placeHolder:'Only sessions created by this extension in this workspace are listed'});
  if(!pick)return;
  await controller.resume(pick.session.id,pick.session.cwd,pick.session.title);
  this.publish();
  this.view.post({type:'showChat'});
 }

 /** Command-palette rename: prefilled so a typo can be corrected in place. */
 private async renameActive():Promise<void>{
  const controller=this.controller;
  const session=controller.active;
  if(!session)throw new Error('Create or select a conversation first');
  const title=await vscode.window.showInputBox({
   title:'Session name',
   prompt:'Shown in the conversation picker and used for exports',
   value:session.title,
   valueSelection:[0,session.title.length],
   validateInput:v=>{
    const clean=v.replace(/[\r\n]+/g,' ').trim();
    return !clean?'Enter a session name':clean.length>120?'Maximum 120 characters':undefined;
   }});
  if(title===undefined)return;
  await controller.rename(session.id,title);
  this.publish();
 }

 /**
  * Open the picker modal. The models are already in the state the webview holds, so this only has to
  * make sure the view is mounted (a command-palette call can arrive before it ever was).
  */
 private async openModelPicker(id?:string):Promise<void>{
  const session=id?this.controller.get(id):this.controller.active;
  if(!session)throw new Error('Create a conversation first');
  await this.view.open();
  const deadline=Date.now()+10_000;
  while(!this.view.isReady&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  this.publish();
  this.view.post({type:'openModelPicker'});
 }

 /** Stored favorites, bounded: the list is a convenience, not a catalog. */
 private favorites():string[]{
  return this.context.globalState.get<string[]>('radcode.favoriteModels',[])
   .filter(id=>typeof id==='string'&&id.length<=400).slice(0,200);
 }
 private postFavorites():void{this.view.post({type:'favorites',ids:this.favorites()});}
 private async setFavorite(m:Record<string,any>):Promise<void>{
  const id=typeof m.id==='string'?m.id.trim():'';
  if(!id||id.length>400)throw new Error('Invalid model identifier');
  const current=this.favorites();
  const next=m.on===true?toggleFavorite(current.filter(x=>x!==id),id):current.filter(x=>x!==id);
  await this.context.globalState.update('radcode.favoriteModels',next);
  this.view.post({type:'favorites',ids:next});
 }

 /** Details for a row the user selected in the modal: lab, context window, effort ladder. */
 private async readModelInfo(m:Record<string,any>):Promise<void>{
  const provider=typeof m.provider==='string'?m.provider.slice(0,200):'';
  const model=typeof m.model==='string'?m.model.slice(0,300):'';
  // A base URL is never taken from the webview: the bridge resolves the provider's own endpoint.
  if(!model)throw new Error('Choose a model first');
  const details=await this.controller.control.modelInfo(provider,model);
  this.view.post({type:'modelDetails',details});
 }

 /** The profile directory, resolved the same way the runtime resolves it. */
 private profileHome():string{
  if(this.profile)return this.profile;
  const configured=vscode.workspace.getConfiguration('radcode').get<string>('hermesHome','')||process.env.HERMES_HOME||'';
  return configured||path.join(homedir(),'.hermes');
 }
 /** Everything Hermes reports about delegation: policy, live children and recent runs. */
 private async readDelegation():Promise<void>{
  try{
   const snapshot=await this.controller.delegation();
   this.view.post({type:'subagents',...snapshot});
  }catch(error){
   this.view.post({type:'subagents',error:String(error instanceof Error?error.message:error),running:[],recent:[]});
  }
 }
 private async readProfileFiles():Promise<void>{
  const home=this.profileHome();
  this.view.post({type:'profile',home,files:await readProfile(home)});
 }
 private async writeProfileFile(m:Record<string,any>):Promise<void>{
  if(typeof m.id!=='string')throw new Error('Unknown profile file');
  const result=await saveProfile(this.profileHome(),m.id,m.text);
  this.view.post({type:'profileSaved',id:result.id,savedAt:result.savedAt});
 }

 private async pickModel(id?:string):Promise<void>{
  const controller=this.controller;
  const session=id?controller.get(id):controller.active;
  if(!session)throw new Error('Create a conversation first');
  if(session.busy)throw new Error('Wait for the turn to finish before changing models');
  // Picker ids are provider-qualified (`openrouter:anthropic/claude-sonnet-4.5`), which is exactly
  // the form `session/set_model` parses, so no separate provider step is needed for a known model.
  const choices=[
   ...session.models.map((m:any)=>({label:m.name||m.modelId,description:`${m.description??''} ${m.modelId}`.trim(),value:m.modelId})),
   {label:'Enter provider and model…',description:'Use an exact Hermes provider + model id',value:''}
  ];
  const pick=await vscode.window.showQuickPick(choices,{title:'Hermes model',placeHolder:session.info?.model});
  if(!pick)return;
  let model=pick.value,provider='';
  if(!model){
   const p=await vscode.window.showInputBox({
    title:'Provider ID',
    prompt:'Existing Hermes provider (e.g. mistral, ollama-cloud, openrouter, openai-codex, anthropic). Credentials stay in Hermes.',
    value:session.info?.provider??''});
   if(p===undefined)return;
   provider=p.trim();
   const m=await vscode.window.showInputBox({title:'Model ID',prompt:'Exact model ID supported by this provider',value:session.info?.model??''});
   if(!m)return;
   model=m.trim();
  }
  await controller.setModel(session.id,model,provider);
  this.publish();
 }

 private async compactActive():Promise<void>{
  const session=this.controller.active;
  if(!session)throw new Error('Create or select a conversation first');
  if(session.busy)throw new Error('Wait for the turn to finish before compacting');
  const focus=await vscode.window.showInputBox({
   title:'Compact session',
   prompt:'Optional: what should the summary keep? (blank summarises everything older)',
   placeHolder:'e.g. the effort-ladder bug'});
  if(focus===undefined)return;
  const result=await this.controller.compact(session.id,focus.trim());
  this.view.post({type:'compacted',id:session.id,...result,focus:focus.trim()});
  this.publish();
 }

 /** Settings entry point for MCP servers: the array itself lives in `radcode.mcpServers`. */
 private async openMcpSettings():Promise<void>{
  let servers:Record<string,unknown>[];
  try{servers=mcpServers();}
  catch(e){throw new Error(`${(e as Error).message} (fix it in radcode.mcpServers)`);}
  const summary=servers.length
   ?servers.map(s=>`${String(s.name)}${'url' in s?' (http)':' (stdio)'}`).join(', ')
   :'none configured';
  const pick=await vscode.window.showQuickPick([
   {label:'$(gear) Edit MCP servers',description:summary,value:'edit'},
   {label:'$(refresh) Test configured servers',description:'Validate every entry',value:'test'},
   {label:'$(new-session) New session with these servers',description:'Hermes registers their tools per session',value:'session'}
  ],{title:'MCP servers'});
  if(!pick)return;
  if(pick.value==='edit'){
   await vscode.commands.executeCommand('workbench.action.openSettings','radcode.mcpServers');
   return;
  }
  if(pick.value==='test'){
   if(!servers.length)throw new Error('No MCP servers configured');
   void vscode.window.showInformationMessage(
    `${servers.length} MCP server entr${servers.length===1?'y is':'ies are'} valid. Hermes connects to them when a session starts.`);
   return;
  }
  await this.newSession();
 }

 /** Command-palette selection attach; the composer's context row is the primary path. */
 private async attachSelection():Promise<void>{
  this.trusted();
  const editor=vscode.window.activeTextEditor;
  if(!editor||editor.selection.isEmpty)throw new Error('Select code in an editor first.');
  const text=editor.document.getText(editor.selection);
  if(text.length>100_000)throw new Error('Selection is too large (maximum 100000 characters).');
  const filename=vscode.workspace.asRelativePath(editor.document.uri);
  await this.view.open();
  // A freshly created webview starts empty; never lose the selection while it boots.
  const deadline=Date.now()+10_000;
  while(!this.view.isReady&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  if(!this.view.isReady)throw new Error('Chat view did not become ready; try attaching again.');
  this.view.post({type:'draft',
   text:`Selected context: ${filename}:${editor.selection.start.line+1}-${editor.selection.end.line+1}\n\n${text}`});
 }

 // ------------------------------------------------------------------ webview messages

 /**
  * One handler per message type.
  *
  * A table rather than a switch: adding a message means adding one line, and the types a compromised
  * webview could reach are all enumerable here. Everything is validated before it is acted on.
  */
 private handlerTable?:Record<string,(m:Record<string,any>,id:()=>string)=>unknown>;
 private handlers():Record<string,(m:Record<string,any>,id:()=>string)=>unknown>{
  return this.handlerTable??=this.buildHandlers();
 }
 private buildHandlers():Record<string,(m:Record<string,any>,id:()=>string)=>unknown>{
  return {
   settings:()=>vscode.commands.executeCommand('radcode.settings'),
   logs:()=>this.output.show(true),
   history:()=>this.history(),
   attach:()=>this.attachSelection(),
   new:()=>this.newSession(),
   model:m=>this.openModelPicker(idOf(m)),
   manualModel:m=>this.pickModel(idOf(m)),
   // Favorites are extension state (globalState), so they survive a window reload and every profile.
   favoritesRequest:()=>this.postFavorites(),
   favorite:m=>this.setFavorite(m),
   modelInfo:m=>this.readModelInfo(m),
   useModel:(m,id)=>{
    if(typeof m.value!=='string')throw new Error('Choose a model first');
    return this.controller.setModel(id(),m.value);
   },
   profile:()=>this.readProfileFiles(),
   subagents:()=>this.readDelegation(),
   saveProfile:m=>this.writeProfileFile(m),
   select:async(m,id)=>{
    const saved=this.context.workspaceState.get<RecentSession[]>('recentSessions',[]).find(s=>s.id===id()&&s.profile===this.profile);
    if(saved)await this.controller.resume(saved.id,saved.cwd,saved.title);
    else this.controller.select(id());
    this.view.post({type:'showChat'});
   },
   rename:(m,id)=>{
    if(typeof m.title!=='string')throw new Error('Enter a session name');
    return this.controller.rename(id(),m.title);
   },
   send:(m,id)=>this.sendMessage(m,id()),
   cancel:(m,id)=>{
    // A cancelled turn leaves its approvals moot; settle them so no card outlives the turn.
    this.permissions.settleSession(id());
    this.controller.cancel(id());
   },
   textSize:(m)=>{
    // Clamp to the setting's own documented range before it reaches the configuration.
    return this.persistTextSize(clampTextSize(m.value));
   },
   effort:(m,id)=>{
    if(typeof m.value!=='string')throw new Error('Invalid effort');
    return this.controller.setEffort(id(),m.value);
   },
   mode:(m,id)=>{
    if(typeof m.value!=='string')throw new Error('Invalid approval mode');
    return this.controller.setMode(id(),m.value);
   },
   savePreset:async m=>{
    await this.presets.save(m.preset??{});
    this.view.post({type:'presetSaved'});
   },
   deletePreset:(m,id)=>{
    const preset=this.presets.list().find(p=>p.id===id());
    if(!preset)return;
    return vscode.window.showWarningMessage(`Delete worker preset “${preset.name}”?`,{modal:true},'Delete')
     .then(answer=>answer==='Delete'?this.presets.remove(preset.id):undefined);
   },
   runWorker:(m,id)=>{
    const preset=this.presets.list().find(p=>p.id===id());
    if(!preset)throw new Error('Preset not found');
    if(typeof m.task!=='string')throw new Error('Enter a task');
    return this.controller.runWorker(preset,m.task);
   },
   useResult:(m,id)=>this.useWorkerResult(id()),
   catalog:(m)=>{
    if(typeof m.provider!=='string'||typeof m.model!=='string'||m.provider.length>200||m.model.length>200)
     throw new Error('Invalid provider/model');
    const baseUrl=typeof m.baseUrl==='string'&&m.baseUrl.length<=500?m.baseUrl:'';
    return this.controller.control.catalog(m.provider,m.model,baseUrl)
     .then(result=>this.view.post({type:'catalog',...result,provider:m.provider,model:m.model}));
   },
   compact:(m,id)=>{
    const focus=typeof m.focus==='string'?m.focus.slice(0,500):'';
    return this.controller.compact(id(),focus)
     .then(result=>this.view.post({type:'compacted',id:id(),...result,focus}));
   },
   permission:(m)=>{
    if(typeof m.requestId!=='string'||typeof m.optionId!=='string')throw new Error('Invalid approval response');
    if(!this.permissions.settle(m.requestId,{outcome:'selected',optionId:m.optionId}))
     throw new Error('That request is no longer open; it may have been answered elsewhere');
   },
   permissionDetails:(m)=>{
    if(typeof m.requestId!=='string')throw new Error('Invalid request id');
    return this.permissions.details(m.requestId);
   },
   screenshot:()=>captureScreenshot(this.view,()=>this.trusted()),
   files:(m)=>this.listFiles(m),
   open:(m)=>{
    if(typeof m.path!=='string'||!path.isAbsolute(m.path))throw new Error('Attachment path must be absolute');
    return vscode.window.showTextDocument(vscode.Uri.file(m.path),{preview:true});
   },
   link:(m)=>{
    if(typeof m.url!=='string')return;
    const url=vscode.Uri.parse(m.url,true);
    if(!['https','http'].includes(url.scheme))throw new Error('Only HTTP(S) links are allowed');
    return vscode.env.openExternal(url);
   }
  };
 }

 /**
  * Persist the base font size.
  *
  * The configuration API throws "not a registered configuration" when the running extension host
  * holds a manifest that predates the setting — which happens after upgrading a VSIX in a window
  * that was never reloaded. The slider must still work in that state, so the value is mirrored into
  * globalState and re-applied on activation; the settings entry stays the source of truth whenever
  * it is registered.
  */
 private async persistTextSize(value:number):Promise<void>{
  await this.context.globalState.update('radcode.textSize',value);
  try{
   await vscode.workspace.getConfiguration('radcode')
    .update('fontSize',value,vscode.ConfigurationTarget.Global);
  }catch(error){
   this.output.appendLine(`Text size kept in extension state (settings entry unavailable): ${String(error)}`);
  }
 }

 private async handle(message:unknown):Promise<void>{
  if(!message||typeof message!=='object')return;
  const m=message as Record<string,any>;
  const invalid=webviewMessageError(m);
  if(invalid)throw new Error(invalid);
  if(m.type==='ready'){this.publish();await this.restoreSessions();return;}
  this.trusted();
  const handler=this.handlers()[m.type];
  if(!handler)throw new Error('Unsupported webview action');
  await handler(m,()=>{
   if(typeof m.id!=='string'||!m.id)throw new Error('Missing session or preset ID');
   return m.id;
  });
  this.publish();
 }

 /**
  * Send a turn. The webview clears the composer optimistically, so every failure path has to return
  * the draft text — otherwise a rejected message silently disappears.
  */
 private async sendMessage(m:Record<string,any>,id:string):Promise<void>{
  if(typeof m.text!=='string')throw new Error('Invalid message');
  try{
   const {attachments,contents}=await readAttachments(m.attachments??[]);
   const images=readImages(m.images);
   await this.controller.send(id,m.text,attachments,contents,images);
  }catch(e){this.report(e,m.text);return;}
  this.view.post({type:'sent',text:m.text});
 }

 /** "Use result" on a worker: put its output in the main chat's composer for review. */
 private async useWorkerResult(id:string):Promise<void>{
  const c=this.controller;
  const result=c.result(id);
  if(!result)throw new Error('No completed assistant output to use yet');
  if(c.get(id).busy)throw new Error('Wait for this worker to finish');
  let main=c.sessions.find(s=>s.kind==='chat'&&!s.busy&&s.status!=='disconnected');
  if(!main)main=await c.create();
  c.select(main.id);
  this.view.post({type:'draft',text:`Worker result (review before sending):\n${result.slice(-100_000)}`});
 }

 /** Bounded workspace search for the attachment picker; a webview cannot list files itself. */
 private async listFiles(m:Record<string,any>):Promise<void>{
  const query=typeof m.query==='string'?m.query.trim():'';
  if(query.length>200)throw new Error('Search is too long');
  const found=query
   ?await vscode.workspace.findFiles('**/*','**/{node_modules,.git,dist,out,.venv,__pycache__}/**',60)
   :vscode.workspace.textDocuments.filter(d=>d.uri.scheme==='file').map(d=>d.uri);
  const paths=found.map(uri=>({path:uri.fsPath,name:vscode.workspace.asRelativePath(uri)}))
   .filter(f=>!query||f.name.toLowerCase().includes(query.toLowerCase()))
   .sort((a,b)=>a.name.split('/').length-b.name.split('/').length||a.name.localeCompare(b.name))
   .slice(0,60);
  this.view.post({type:'files',paths,query});
 }

 // ------------------------------------------------------------------ errors & teardown

 /** Surface a failure in both places the user might be looking, with the draft when relevant. */
 private report(error:unknown,draft?:string):void{
  const message=error instanceof Error?error.message:String(error);
  this.view.post({type:'error',message,draft});
  void vscode.window.showErrorMessage(message);
 }

 dispose():void{
  this.permissions.settleAll();
  if(this.renderTimer)clearTimeout(this.renderTimer);
  this.service?.dispose();
  this.disposables.splice(0).forEach(d=>d.dispose());
 }
}

const idOf=(m:Record<string,any>):string|undefined=>typeof m.id==='string'?m.id:undefined;

/** Strip credentials out of anything Hermes prints on stderr before it reaches the log channel. */
export function redact(text:string):string{
 return text
  .replace(/(Bearer\s+)[^\s"']+/gi,'$1[redacted]')
  .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,}]+/gi,'$1[redacted]');
}
