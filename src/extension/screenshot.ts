/**
 * @module screenshot
 * Capture a screen the model can actually look at, then hand it to the composer as an image.
 *
 * The composer then treats it exactly like a paste: it is sniffed, budgeted and sent as an ACP image
 * block. Nothing here decides what the model does with it.
 */
import * as vscode from 'vscode';
import {execFile as execFileCallback} from 'node:child_process';
import {readFile, unlink} from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {sniffImage} from './media';
import type {ChatViewProvider} from '../presentation/ChatViewProvider';

const execFileAsync=promisify(execFileCallback);

// Two backends only: headless Chromium for a URL (a dev server, usually) and X11 root for the
// desktop. `radcode.screenshotCommand` is intentionally not consulted here — it is a future hook.
export async function captureScreenshot(view:ChatViewProvider,trusted:()=>void):Promise<void>{
  trusted();
  const kind=await vscode.window.showQuickPick([
   {label:'Browser page (URL)',description:'Headless Chromium screenshot of a local or remote page',value:'url'},
   {label:'Desktop',description:'Primary display as the user sees it',value:'desktop'}
  ],{title:'Screenshot',placeHolder:'What should be captured?'});
  if(!kind)return;
  let file:string;
  if(kind.value==='desktop'){
   if(process.platform!=='linux')throw new Error('Desktop capture is implemented for X11 only');
   file=path.join(os.tmpdir(),`radcode-screen-${Date.now()}.png`);
   await execFileAsync('import',['-window','root',file],{timeout:20_000}).catch(()=>{
    throw new Error('Desktop capture needs ImageMagick (import) on PATH');
   });
  }else{
   const url=await vscode.window.showInputBox({title:'Screenshot URL',value:'http://localhost:8080/',prompt:'Any http(s) URL, e.g. a headless dev server'});
   if(!url)return;
   if(!/^https?:\/\//i.test(url))throw new Error('Enter an http(s) URL');
   file=path.join(os.tmpdir(),`radcode-page-${Date.now()}.png`);
   // Chromium is used only as a capture backend: no profile, no extensions, no network beyond the URL.
   await execFileAsync(process.platform==='win32'?'npx.cmd':'npx',
    ['--yes','playwright','screenshot','--viewport-size=1280,800','--wait-for-timeout=1200',url,file],
    {timeout:120_000}).catch((e:Error)=>{
     throw new Error(`Screenshot failed: ${e.message.split('\n')[0].slice(0,300)}`);
    });
  }
  const data=await readFile(file,{encoding:'base64'});
  await unlink(file).catch(()=>{});
  const mime=sniffImage(Buffer.from(data.slice(0,512),'base64'))??'image/png';
  await view.open();
  view.post({type:'image',name:path.basename(file),mime,data});
 }

