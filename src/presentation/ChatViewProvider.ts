import * as vscode from 'vscode';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

/** Presentation adapter: webview has no Node, filesystem, credentials, or network access. */
export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
 private view?:vscode.WebviewView;
 private subscriptions:vscode.Disposable[]=[];
 private state:unknown;
 private queued:unknown[]=[];
 isReady=false;
 onMessage:(message:unknown)=>Promise<void>=async()=>{};
 constructor(private extensionUri:vscode.Uri){}
 resolveWebviewView(view:vscode.WebviewView):void {
  this.view=view;this.isReady=false;
  view.webview.options={enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(this.extensionUri,'media'),vscode.Uri.joinPath(this.extensionUri,'dist')]};
  const resources={
   '{{cspSource}}':view.webview.cspSource,
   '{{nonce}}':randomBytes(24).toString('hex'),
   '{{styleUri}}':view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri,'media','style.css')).toString(),
   '{{scriptUri}}':view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri,'dist','webview.js')).toString()
  };
  let html=readFileSync(vscode.Uri.joinPath(this.extensionUri,'media','view.html').fsPath,'utf8');
  for(const [key,value]of Object.entries(resources))html=html.replaceAll(key,value);
  view.webview.html=html;
  this.subscriptions.push(view.webview.onDidReceiveMessage(async message=>{
   if(message?.type==='ready'){this.isReady=true;if(this.state)this.post(this.state);this.flush();}
   try{await this.onMessage(message);}catch(e){this.post({type:'error',message:e instanceof Error?e.message:String(e)});}
  }));
  this.subscriptions.push(view.onDidDispose(()=>{this.isReady=false;this.view=undefined;}));
 }
 stateChanged(state:unknown):void{this.state=state;if(this.isReady)this.post(state);}
 /**
  * Posts are queued until the webview reports ready. An approval request that arrives while the
  * view is still booting used to be dropped, and the request then timed out as a silent denial.
  */
 post(message:unknown):void{
  if(!this.view||!this.isReady){
   this.queued.push(message);
   if(this.queued.length>200)this.queued.shift();
   return;
  }
  void this.view.webview.postMessage(message);
 }
 private flush():void{
  const pending=this.queued;this.queued=[];
  for(const message of pending)void this.view?.webview.postMessage(message);
 }
 async open():Promise<void>{await vscode.commands.executeCommand('workbench.view.extension.radcode');await vscode.commands.executeCommand('radcode.chat.focus');}
 dispose():void{this.subscriptions.forEach(s=>s.dispose());this.view=undefined;this.isReady=false;}
}
