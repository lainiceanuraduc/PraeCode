/**
 * @module Inputs
 * Turns the webview's *references* into things Hermes can send: file bodies and image bytes.
 *
 * The webview only ever names paths and hands over clipboard bytes; every rule is enforced here, on
 * the side that has Node and the workspace. A path is re-validated at send time (not when it was
 * attached), so what the model receives is the file as it is now.
 */
import * as vscode from 'vscode';
import path from 'node:path';
import {stat,readFile} from 'node:fs/promises';
import {sniffImage} from './media';
import {Attachment,attachmentBudgetError,ActiveEditorContext,MAX_ATTACHMENTS} from '../domain/Attachments';
import {ImageAttachment,IMAGE_MIME,MAX_IMAGES,base64Bytes,imageBudgetError} from '../domain/Images';

 /** The editor the user is looking at, or undefined when it is not a readable workspace file. */
export function editorContext():ActiveEditorContext|undefined{
  const editor=vscode.window.activeTextEditor;
  if(!editor||editor.document.uri.scheme!=='file'||editor.document.isUntitled)return undefined;
  // Output channels, notebooks and diffs are not files the model should be handed implicitly.
  if(editor.document.uri.path.endsWith('.git'))return undefined;
  return {path:editor.document.uri.fsPath,name:vscode.workspace.asRelativePath(editor.document.uri),
          line:editor.selection.active.line+1};
 }
 /**
  * Resolve a webview attachment request. Paths are re-validated here: absolute, a regular file, and
  * inside a workspace folder. The webview never supplies content, so nothing can be spoofed.
  */
async function oneAttachment(request:unknown):Promise<Attachment>{
  const r=request as {path?:unknown;line?:unknown};
  if(!r||typeof r.path!=='string'||!path.isAbsolute(r.path))throw new Error('Attachment path must be absolute');
  const uri=vscode.Uri.file(r.path);
  const folder=vscode.workspace.getWorkspaceFolder(uri);
  if(!folder||folder.uri.scheme!=='file')throw new Error(`${path.basename(r.path)} is outside the workspace and cannot be attached`);
  const info=await stat(r.path).catch(()=>undefined);
  if(!info?.isFile())throw new Error(`${path.basename(r.path)} is not a file`);
  const line=Number.isInteger(r.line)&&(r.line as number)>0?(r.line as number):undefined;
  return {path:r.path,name:vscode.workspace.asRelativePath(uri),size:info.size,line};
 }
export async function readAttachments(list:unknown):Promise<{attachments:Attachment[];contents:string[]}>{
  if(!Array.isArray(list))throw new Error('Invalid attachment list');
  if(list.length>MAX_ATTACHMENTS)throw new Error(`Attach at most ${MAX_ATTACHMENTS} files`);
  const attachments=await Promise.all(list.map(item=>oneAttachment(item)));
  // Duplicates would send the same body twice; the picker prevents them, this guarantees it.
  const unique=attachments.filter((a,i)=>attachments.findIndex(b=>b.path===a.path)===i);
  const budget=attachmentBudgetError(unique);
  if(budget)throw new Error(budget);
  const readings=await Promise.all(unique.map(async a=>({
   text:await readFile(a.path,'utf8').catch((e:NodeJS.ErrnoException)=>e.code==='ERR_INVALID_ARG'?undefined:'')
  })));
  const binary=unique.find((a,i)=>readings[i].text===undefined&&a.size>0);
  if(binary)throw new Error(`${binary.name} is not readable as text; attach a text file instead`);
  return {attachments:unique,contents:readings.map(r=>r.text??'')};
 }
 /**
  * Pasted images arrive as base64 from the webview. The MIME type is re-derived from the bytes, not
  * trusted from the message: a declared image/png that is really something else is refused.
  */
export function readImages(list:unknown):ImageAttachment[]{
  if(!Array.isArray(list)||!list.length)return [];
  if(list.length>MAX_IMAGES)throw new Error(`Attach at most ${MAX_IMAGES} images`);
  const images=list.map((raw,index)=>{
   const item=raw as {data?:unknown;name?:unknown};
   if(typeof item?.data!=='string'||!item.data)throw new Error(`Image #${index+1} has no data`);
   const data=item.data.replace(/^data:[^,]*,/,'');
   const bytes=Buffer.from(data.slice(0,512),'base64');
   const mime=sniffImage(bytes);
   if(!mime)throw new Error(`Image #${index+1} is not a PNG, JPEG, WebP or GIF`);
   const name=typeof item.name==='string'&&item.name.trim()?item.name.trim().slice(0,120):`pasted-${index+1}.${IMAGE_MIME[mime]}`;
   return {name,mime,data,size:base64Bytes(data)};
  });
  const budget=imageBudgetError(images);
  if(budget)throw new Error(budget);
  return images;
 }

