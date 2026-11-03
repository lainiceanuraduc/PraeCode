import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import type {ChangeRecord,ChangeSummary} from '../domain/Changes';

const FILE_LIMIT=1024*1024;
const STORE_LIMIT=16*1024*1024;
const RECORD_LIMIT=100;
const inside=(root:string,file:string)=>{const rel=path.relative(root,file);return !!rel&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};

/**
 * Review journal for edits Hermes has already applied.
 *
 * Hermes has two capture shapes, so this has two paths. The local ACP adapter sends a complete
 * before/after diff, which can be checked against the file it claims to describe. The gateway sends
 * only a location, so the file is snapshotted around the tool event and accepted only if it changed
 * exactly once, with no other write to the same file in flight. Neither path is a backup: rollback is
 * per record, requires the on-disk bytes to still equal the recorded after-image, and is never
 * automatic. Shell edits, binary files and ambiguous patches are deliberately not rollback sources.
 */
export class ChangeJournal {
 private records:ChangeRecord[]=[];
 /** Files where two writes raced in one session: no completion there is attributable afterwards. */
 private readonly tainted=new Set<string>();
 notice='';
 constructor(private storage:string|undefined){
  if(!storage)return;
  try{
   if(!fs.existsSync(storage))return;
   if(fs.lstatSync(storage).isSymbolicLink()||fs.statSync(storage).size>STORE_LIMIT)throw new Error('Invalid review store');
   const value=JSON.parse(fs.readFileSync(storage,'utf8'));
   if(value.version!==1||!Array.isArray(value.records)||value.records.length>RECORD_LIMIT)throw new Error('Invalid review store');
   this.records=value.records.filter((r:any)=>this.valid(r));
   for(const r of this.records)if(r.state==='pending'){
    r.state='unavailable';r.verified=false;r.note='Interrupted before completion was confirmed; review only.';
   }
  }catch{this.notice='Could not load saved changes. Existing review data was not overwritten.';this.storage=undefined;}
 }
 private valid(r:any):r is ChangeRecord{
  const text=(v:any)=>v===null||v===undefined||typeof v==='string';
  return r&&['id','sessionId','profile','cwd','path','toolCallId','note'].every(k=>typeof r[k]==='string')
   &&text(r.before)&&text(r.after)&&typeof r.verified==='boolean'&&typeof r.canReview==='boolean'
   &&Number.isFinite(r.at)&&['pending','ready','kept','reverted','unavailable'].includes(r.state)
   &&Buffer.byteLength(r.after??'')+Buffer.byteLength(r.before??'')<=FILE_LIMIT*2;
 }
 list(profile:string):ChangeSummary[]{
  return this.records.filter(r=>r.profile===profile)
   .map(({id,sessionId,path,at,state,note,canReview})=>({id,sessionId,path,at,state,note,canReview})).reverse();
 }
 get(id:string,profile:string):ChangeRecord{
  const r=this.records.find(r=>r.id===id&&r.profile===profile);
  if(!r)throw new Error('Change not found in this profile');
  return {...r};
 }
 private record(id:string):ChangeRecord{
  const found=this.records.find(r=>r.id===id);
  if(!found)throw new Error('Change not found');
  return found;
 }
 private save():void{
  if(!this.storage){this.notice||='Review history is held in memory only in this window.';return;}
  const temp=this.storage+'.'+randomUUID()+'.tmp';
  try{
   fs.mkdirSync(path.dirname(this.storage),{recursive:true,mode:0o700});
   fs.writeFileSync(temp,JSON.stringify({version:1,records:this.records}),{mode:0o600,flag:'wx'});
   fs.renameSync(temp,this.storage);
  }catch{
   this.notice='Could not persist review history; keep this window open. Changes remain in memory.';
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 }
 /** Refuse symlinks (including parents), hardlinks, outside-workspace and sensitive targets. */
 private safePath(cwd:string,target:string):string{
  const root=path.resolve(cwd),file=path.resolve(root,target);
  if(!inside(root,file))throw new Error('Target is outside the recorded workspace');
  const parts=file.split(path.sep).filter(Boolean);
  const rel=path.relative(root,file).split(path.sep);
  if(rel.some(p=>p==='.git'||p==='.ssh'||p==='.hermes'||p==='.env'||p.startsWith('.env.')
   ||/^id_(rsa|ed25519|ecdsa)/.test(p)||/\.(pem|key|p12|pfx)$/i.test(p)))
   throw new Error('Sensitive paths are not stored for review');
  let current=path.parse(file).root;
  for(let i=0;i<parts.length;i++){
   current=path.join(current,parts[i]);
   const last=i===parts.length-1;
   try{
    const stat=fs.lstatSync(current);
    if(stat.isSymbolicLink())throw new Error('Symlink targets cannot be reviewed or reverted');
    if(!last&&!stat.isDirectory())throw new Error('Invalid parent directory');
    if(last&&(!stat.isFile()||stat.nlink!==1))throw new Error('Only regular single-link files can be reviewed');
   }catch(e){
    if((e as NodeJS.ErrnoException).code==='ENOENT'&&last)return file;
    throw e;
   }
  }
  return file;
 }
 /** Current text, or null when absent. Throws for binary, oversized or non-regular targets. */
 private text(file:string):string|null{
  try{
   const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
   try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.size>FILE_LIMIT||stat.nlink!==1)throw new Error('File exceeds review limits or is not regular');
    const bytes=fs.readFileSync(fd);
    if(bytes.length>FILE_LIMIT||bytes.includes(0))throw new Error('Binary or oversized file');
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
   }finally{fs.closeSync(fd);}
  }catch(e){
   if((e as NodeJS.ErrnoException).code==='ENOENT')return null;
   throw e;
  }
 }
 private modeOf(file:string):number|undefined{
  try{return fs.statSync(file).mode&0o777;}catch{return undefined;}
 }
 observe(profile:string,sessionId:string,cwd:string,update:any,live:boolean):void{
  if(!live||!['tool_call','tool_call_update'].includes(update?.sessionUpdate)||typeof update.toolCallId!=='string')return;
  let changed=false;
  const complete=['completed','failed'].includes(update.status);
  if(update.sessionUpdate==='tool_call'&&!complete){
   // Replay and late completions cannot retroactively establish a before-image.
   const diffs=(Array.isArray(update.content)?update.content:[]).filter((c:any)=>c?.type==='diff');
   for(const diff of diffs){
    if(typeof diff.path!=='string'||typeof diff.newText!=='string')continue;
    if(this.records.some(r=>r.profile===profile&&r.sessionId===sessionId&&r.toolCallId===update.toolCallId&&r.path===path.resolve(cwd,diff.path)))continue;
    if(this.records.length>=RECORD_LIMIT){this.notice='Review limit reached (100 records). Clear reviewed entries to record more; nothing was silently discarded.';break;}
    const r:ChangeRecord={id:randomUUID(),profile,sessionId,cwd:path.resolve(cwd),path:path.resolve(cwd,diff.path),
     toolCallId:update.toolCallId,at:Date.now(),state:'pending',note:'Waiting for successful completion.',
     before:null,after:null,verified:false,canReview:false};
    try{
     const file=this.safePath(cwd,diff.path);
     if(diff.newText.startsWith('*** Begin Patch')||(diff.oldText!=null&&typeof diff.oldText!=='string'))
      throw new Error('Patch or incomplete snapshot; automatic rollback unavailable');
     if(Buffer.byteLength(diff.newText)+Buffer.byteLength(diff.oldText??'')>FILE_LIMIT*2)
      throw new Error('Diff exceeds the 2 MiB review limit');
     r.before=diff.oldText;r.after=diff.newText;r.canReview=true;r.mode=this.modeOf(file);
     const current=this.text(file);
     if(current!==r.before){
      if(r.before===null&&current!==r.after){
       // A gateway write_file start omits the old content: capture the existing file now.
       r.before=current;
      }else if(typeof current==='string'&&typeof r.before==='string'&&r.before.length
       &&current.includes(r.before)&&current.indexOf(r.before)===current.lastIndexOf(r.before)){
       // A gateway replace preview carries old_string/new_string. One exact occurrence is
       // unambiguous, and completion must still match this whole-file reconstruction.
       const from=r.before,to=r.after??'';
       r.after=current.replace(from,()=>to);r.before=current;
      }else throw new Error('Before-image could not be verified before execution; review only');
     }
     if(r.before===r.after)throw new Error('No distinct before-image was captured; the edit may already have run');
     if(Buffer.byteLength(r.after??'')+Buffer.byteLength(r.before??'')>FILE_LIMIT*2)
      throw new Error('Reconstructed diff exceeds review limits');
     r.verified=true;
    }catch(e){r.state='unavailable';r.note=(e as Error).message;}
    if(Buffer.byteLength(JSON.stringify(this.records))+Buffer.byteLength(JSON.stringify(r))>STORE_LIMIT-1024){
     this.notice='Review storage limit reached (16 MiB). Clear reviewed entries to record more.';continue;
    }
    this.records.push(r);changed=true;
   }
   // The gateway announces an edit with locations and no diff. Snapshot both sides around it.
   const locations=(Array.isArray(update.locations)?update.locations:[]).filter((l:any)=>typeof l?.path==='string');
   if(!diffs.length&&update.kind==='edit'&&locations.length){
    for(const location of locations){
     const target=path.resolve(cwd,location.path);
     if(this.records.some(r=>r.profile===profile&&r.toolCallId===update.toolCallId&&r.path===target))continue;
     if(this.records.length>=RECORD_LIMIT){this.notice='Review limit reached (100 records). Clear reviewed entries to record more.';break;}
     const r:ChangeRecord={id:randomUUID(),profile,sessionId,cwd:path.resolve(cwd),path:target,
      toolCallId:update.toolCallId,at:Date.now(),state:'pending',note:'Waiting for successful completion.',
      before:null,after:null,verified:false,canReview:false,observed:true};
     try{
      const file=this.safePath(cwd,location.path);
      r.before=this.text(file);r.mode=this.modeOf(file);r.canReview=true;
     }catch(e){r.state='unavailable';r.note=(e as Error).message;}
     this.records.push(r);changed=true;
    }
   }
   if(!diffs.length&&!locations.length&&update.kind==='edit')
    this.notice='An edit arrived without a diff or a file location, so it cannot be reviewed.';
  }
  if(complete){
   for(const r of this.records){
    if(r.profile!==profile||r.sessionId!==sessionId||r.toolCallId!==update.toolCallId||r.state!=='pending')continue;
    changed=true;
    const key=`${profile}|${sessionId}|${r.path}`;
    try{
     if(update.status!=='completed')throw new Error('Tool did not complete successfully; rollback unavailable');
     // Once two writes raced on one file, no later completion on it can be attributed either.
     if(this.tainted.has(key))throw new Error('An overlapping write to this file could not be attributed; review only');
     if(this.records.some(o=>o!==r&&o.state==='pending'&&o.path===r.path&&o.sessionId===r.sessionId)){
      this.tainted.add(key);
      throw new Error('Another write to this file was in flight; the result cannot be attributed safely');
     }
     const now=this.text(this.safePath(r.cwd,r.path));
     if(r.observed){
      if(now===r.before)throw new Error('The file is unchanged; this tool call left no edit');
      r.after=now;
     }else if(now!==r.after)throw new Error('Result differs from the captured proposal; review only');
     if(r.before===r.after)throw new Error('The file is unchanged; this tool call left no edit');
     if(Buffer.byteLength(r.after??'')+Buffer.byteLength(r.before??'')>FILE_LIMIT*2)
      throw new Error('Recorded change exceeds the review limit');
     r.verified=true;r.state='ready';r.note='Applied to disk; awaiting your review.';
    }catch(e){r.state='unavailable';r.verified=false;r.note=(e as Error).message;}
   }
  }
  if(changed)this.save();
 }
 settleSession(profile:string,sessionId:string):void{
  let changed=false;
  for(const r of this.records)if(r.profile===profile&&r.sessionId===sessionId&&r.state==='pending'){
   r.state='unavailable';r.verified=false;r.note='Turn ended without confirmed completion; review only.';changed=true;
  }
  if(changed)this.save();
 }
 keep(id:string,profile:string):void{
  const r=this.get(id,profile);
  if(r.state!=='ready'&&r.state!=='unavailable')throw new Error('Wait for this change to finish');
  Object.assign(this.record(id),{state:'kept',note:'Marked reviewed; files were not changed.'});this.save();
 }
 clearReviewed(profile:string):void{
  this.records=this.records.filter(r=>r.profile!==profile||!['kept','reverted'].includes(r.state));
  this.notice='';this.save();
 }
 revert(id:string,profile:string,roots:string[]):void{
  const r=this.get(id,profile);
  if(r.state!=='ready'||!r.verified)throw new Error('This change has no verified rollback snapshot');
  if(!roots.some(root=>inside(path.resolve(root),r.path)))throw new Error('Target is not in the current workspace');
  const file=this.safePath(r.cwd,r.path);
  const before=r.before;
  const after=r.after;
  let handle:{fd:number;text:string;mode:number;ino:number;dev:number}|undefined;
  try{
   // Verify BEFORE recording any intent: a refusal here writes nothing and leaves the entry
   // reviewable, so the user can fix the file and retry. Opening the descriptor now also means the
   // later write cannot be redirected by a swap of the path.
   if(before!==null&&after!==null){
    handle=this.openVerified(file);
    if(handle.text!==after)throw new Error(ChangeJournal.CHANGED);
   }else if(before===null){
    if(after===null)throw new Error('Nothing to restore');
    this.assertContent(file,after,'Nothing was deleted.');
   }else{
    // The agent deleted the file: nothing may have reappeared under that name.
    if(this.text(file)!==null)throw new Error('A file appeared at this path after the recorded edit. Nothing was written.');
   }
   // Past this point the revert will run: persist the intent so a crash cannot re-offer it.
   const stored=this.record(id);
   stored.state='unavailable';stored.note='Rollback started; inspect the file if interrupted.';this.save();
   try{
    if(handle)this.writeVerified(handle,file,before!);
    else if(before===null)this.deleteVerified(file,after!);
    else this.createVerified(file,before,r.mode??0o644);
    if(this.text(file)!==before)throw new Error('Rollback could not be confirmed');
    stored.state='reverted';stored.note='Reverted to the captured before-image.';
   }catch(e){
    stored.note='Rollback failed or interrupted; inspect the file: '+(e as Error).message;
    throw e;
   }
  }finally{
   if(handle)try{fs.closeSync(handle.fd);}catch{/* already closed */}
   this.save();
  }
 }
 /** Shared refusal text: the file no longer matches what was recorded. */
 private static readonly CHANGED='File changed since this edit. Revert newer changes first or resolve the diff manually. Nothing was overwritten.';
 /** Read-only check that the file still holds the recorded after-image. */
 private assertContent(file:string,after:string,detail:string):void{
  if(this.text(file)!==after)throw new Error(`${ChangeJournal.CHANGED} ${detail}`);
 }
 /** Rewrite the verified descriptor in place: same inode, so the path is never re-resolved. */
 private writeVerified(handle:{fd:number;mode:number;ino:number;dev:number},file:string,before:string):void{
  fs.ftruncateSync(handle.fd,0);
  fs.writeSync(handle.fd,before,0,'utf8');
  if(this.readDescriptor(handle.fd)!==before)throw new Error('Rollback could not be confirmed through the verified handle');
  const now=fs.lstatSync(file);
  if(now.isSymbolicLink()||now.ino!==handle.ino||now.dev!==handle.dev)
   throw new Error('The file was replaced while rolling back; the captured before-image was written to the original file only');
  if(handle.mode!==undefined)withQuietChmod(file,handle.mode);
 }
 /**
  * Open the target exactly once and return the verified descriptor.
  *
  * `O_NOFOLLOW` makes a symlink at the path fail instead of being followed, and every later read or
  * write uses this descriptor — so a swap that replaces the path after this point cannot redirect the
  * rollback. Hardlinked files are refused: another name could observe or mutate the same bytes.
  */
 private openVerified(file:string):{fd:number;text:string;mode:number;ino:number;dev:number}{
  const fd=fs.openSync(file,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);
  try{
   const stat=fs.fstatSync(fd);
   if(!stat.isFile())throw new Error('Target is not a regular file');
   if(stat.nlink!==1)throw new Error('Target has multiple hard links; refusing to modify shared bytes');
   if(stat.size>FILE_LIMIT)throw new Error('Target exceeds the review size limit');
   return {fd,text:this.readDescriptor(fd),mode:stat.mode&0o777,ino:stat.ino,dev:stat.dev};
  }catch(e){fs.closeSync(fd);throw e;}
 }
 /** Read the whole descriptor from offset 0, verifying it is still text within limits. */
 private readDescriptor(fd:number):string{
  const size=fs.fstatSync(fd).size;
  if(size>FILE_LIMIT)throw new Error('Target exceeds the review size limit');
  const buffer=Buffer.alloc(size);
  let offset=0;
  while(offset<size){
   const read=fs.readSync(fd,buffer,offset,size-offset,offset);
   if(read<=0)break;
   offset+=read;
  }
  const bytes=buffer.subarray(0,offset);
  if(bytes.includes(0))throw new Error('Target is binary');
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
 }
 /** Recreate a file the agent deleted; `wx` guarantees an existing name is never clobbered. */
 private createVerified(file:string,before:string,mode:number):void{
  fs.writeFileSync(file,before,{encoding:'utf8',mode,flag:'wx'});
  if(this.text(file)!==before){
   withQuietUnlink(file);
   throw new Error('Recreated file did not match the captured before-image; nothing was left behind');
  }
 }
 /**
  * Delete a file the agent created.
  *
  * Node cannot unlink through a descriptor, so the inode is verified through an `O_NOFOLLOW` handle
  * and compared with `lstat` immediately before the unlink; a replacement after that comparison can
  * still remove the wrong name, which is why this is limited to files the journal watched change.
  */
 private deleteVerified(file:string,after:string):void{
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let stat:fs.Stats;
  try{
   stat=fs.fstatSync(fd);
   if(!stat.isFile()||stat.nlink!==1)throw new Error('Refusing to delete a non-regular or hardlinked target');
   if(this.readDescriptor(fd)!==after)
    throw new Error('File changed since this edit. Nothing was deleted.');
  }finally{fs.closeSync(fd);}
  const current=fs.lstatSync(file);
  if(current.isSymbolicLink()||current.ino!==stat.ino||current.dev!==stat.dev)
   throw new Error('The file was replaced before it could be removed; nothing was deleted');
  fs.unlinkSync(file);
 }
}

/** Best-effort cleanup of a file this module just created. */
function withQuietUnlink(file:string):void{
 try{fs.unlinkSync(file);}catch{/* nothing to clean up */}
}

/** chmod is best-effort: a rollback that restored the text must not fail on an exotic filesystem. */
function withQuietChmod(file:string,mode:number):void{
 try{fs.chmodSync(file,mode);}catch{/* mode is cosmetic here; the content is what matters */}
}
