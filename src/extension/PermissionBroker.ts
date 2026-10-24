/**
 * @module PermissionBroker
 * Routes Hermes' ACP permission requests to the chat view and resolves them back.
 *
 * Why not a modal: a tool request can carry a diff far larger than an editor window, so a modal
 * cannot show it. The card shows a bounded summary plus one button per option Hermes offered;
 * "Details" opens the full payload in a scrollable read-only document.
 *
 * Lifecycle rules that matter: every request gets a deadline (a closed webview must not hang a
 * turn), a cancel settles its session's open requests, and dispose settles everything left.
 */
import * as vscode from 'vscode';
import {randomUUID} from 'node:crypto';
import {safeJson} from './media';
import type {ChatViewProvider} from '../presentation/ChatViewProvider';

interface PendingPermission {resolve:(r:{optionId?:string;outcome:string})=>void;params:any;timer?:NodeJS.Timeout;}

 /**
  * Approvals are decided in the chat view, not in a modal: the tool arguments can be megabytes of
  * diff and a modal that big does not fit an editor window. The card shows a bounded summary with
  * Allow / Allow all / Deny; "Details" opens a scrollable read-only document instead.
  */
export class PermissionBroker {
 /** Open requests by id; each resolver is settled exactly once (answer, cancel, deadline, dispose). */
 private pending=new Map<string,{resolve:(r:{optionId?:string;outcome:string})=>void;params:any;timer?:NodeJS.Timeout}>();
 constructor(private view:ChatViewProvider,private sessions:()=>{id:string;title:string}[],
             private onExpired:(text:string)=>void=()=>{}){}
 /**
  * A request that cannot be shown is still a decision the user deserves to see. Every path that ends
  * in "cancelled" without an answer says so, in the view and in the connection log: a silent denial
  * used to look like the edit simply failed.
  */
 private denyVisibly(text:string):void{
  this.onExpired(text);
  this.view.post({type:'error',message:text});
 }
 /** Ask the chat view and wait for the user; never resolves to "allowed" on its own. */
 async request(params:any):Promise<any>{
  if(!vscode.workspace.isTrusted){
   this.denyVisibly('Hermes asked to run a tool, but this workspace is not trusted, so the request was denied.');
   return {outcome:{outcome:'cancelled'}};
  }
  // Keep every option Hermes sent: allow_session arrives as kind "allow_always" and is the
  // "accept all" the user expects, so filtering on two kinds silently removed it.
  const raw=Array.isArray(params?.options)?params.options:[];
  const options=raw.filter((o:any)=>typeof o?.optionId==='string');
  if(!options.length){
   this.denyVisibly('Hermes asked for approval but offered no option, so the request was denied.');
   return {outcome:{outcome:'cancelled'}};
  }
  const session=this.sessions().find(s=>s.id===params.sessionId);
  const title=String(params.toolCall?.title??'Tool permission').slice(0,300);
  const requestId=randomUUID();
  const detail=this.detail(params);
  const response=await new Promise<{optionId?:string;outcome:string}>((resolve)=>{
   this.pending.set(requestId,{resolve,params});
   this.view.post({type:'permission',requestId,sessionId:params.sessionId,sessionTitle:session?.title??'Hermes',
    title,summary:detail.summary,tool:params.toolCall?.kind??'',options:options.map((o:any)=>{
     const kind=String(o.kind??'');
     const label=String(o.name??o.optionId).slice(0,120);
     return {optionId:String(o.optionId),kind,label,
      role:kind.startsWith('allow')?(kind==='allow_once'?'allow':'allow-all'):'deny'};
    })});
   // The webview is not always mounted (view closed / reloaded): never leave a turn hanging, and
   // never let the deadline pass as a silent denial — say what expired and that nothing was allowed.
   const deadline=setTimeout(()=>{
    if(!this.pending.has(requestId))return;
    this.denyVisibly(`Approval request timed out after 120s and was denied: ${title}`);
    this.settle(requestId,{outcome:'cancelled'});
   },120_000);
   this.pending.get(requestId)!.timer=deadline;
  });
  if(response.outcome==='selected'&&response.optionId)return {outcome:{outcome:'selected',optionId:response.optionId}};
  return {outcome:{outcome:'cancelled'}};
 }
 settle(requestId:string,result:{optionId?:string;outcome:string}):boolean{
  const pending=this.pending.get(requestId);
  if(!pending)return false;
  if(pending.timer)clearTimeout(pending.timer);
  this.pending.delete(requestId);
  this.view.post({type:'permissionSettled',requestId});
  pending.resolve(result);
  return true;
 }
 /** Bounded summary for the card; the full payload goes to the details document. */
 private detail(params:any):{summary:string;body:string}{
  const tool=params?.toolCall??{};
  const parts:string[]=[];
  if(tool.title)parts.push(String(tool.title));
  if(tool.kind)parts.push(`Kind: ${tool.kind}`);
  const input=tool.rawInput??{};
  const command=typeof input.command==='string'?input.command:'';
  if(command)parts.push(command.slice(0,400));
  const diff=(Array.isArray(tool.content)?tool.content:[]).find((c:any)=>c?.type==='diff');
  const target=(diff?.path||'')||(typeof input.file_path==='string'?input.file_path:'')||(typeof input.path==='string'?input.path:'');
  if(target)parts.push(`Target: ${target}`);
  const summary=parts.join('\n').slice(0,1200)||'Hermes is asking to run a tool.';
  const body=[
   `# ${String(tool.title??'Tool permission')}`,
   '',
   `**Session:** ${String(params?.sessionId??'')}`,
   tool.kind?`**Kind:** ${tool.kind}`: '',
   target?`**Target:** ${target}`:'',
   '',
   '## Arguments',
   '```json',
   safeJson(input),
   '```',
   ...(Array.isArray(tool.content)&&tool.content.length?['', '## Content', '```', safeJson(tool.content).slice(0,400_000), '```']:[]),
   '',
   '## Options offered by Hermes',
   ...(Array.isArray(params?.options)?params.options.map((o:any)=>`- ${o.name} (${o.kind})`):[])
  ].filter(line=>line!=='').join('\n');
  return {summary,body};
 }
 /** "Details" opens the full request in a scrollable read-only editor tab. */
 async details(requestId:string):Promise<void>{
  const pending=this.pending.get(requestId);
  if(!pending)throw new Error('This request is no longer open');
  const {summary,body}=this.detail(pending.params);
  const doc=await vscode.workspace.openTextDocument({content:body,language:'markdown'});
  await vscode.window.showTextDocument(doc,{preview:true});
  void summary;
 }

 /** Settle every open request (cancel a turn, or shut down the extension). */
 settleSession(sessionId:string):void{
  for(const [requestId,pending] of this.pending)
   if(pending.params?.sessionId===sessionId)this.settle(requestId,{outcome:'cancelled'});
 }
 settleAll():void{for(const requestId of [...this.pending.keys()])this.settle(requestId,{outcome:'cancelled'});}
}
