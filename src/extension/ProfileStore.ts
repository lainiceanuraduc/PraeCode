/**
 * @module ProfileStore
 * Reads and writes the allowlisted Hermes profile documents for the Features tab.
 *
 * Writes go through a temp file + rename: a half-written SOUL.md would be loaded by the next
 * session, and the file the user is editing is the agent's own persona.
 */
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {PROFILE_FILES,profileWriteError,resolveProfilePath} from '../domain/HermesProfile';
import type {ProfileFile} from '../domain/HermesProfile';

export interface ProfileDocument extends ProfileFile {path:string;content:string;exists:boolean;}

/** Every exposed document, with its current text; a missing file is reported, not created. */
export async function readProfile(home:string):Promise<ProfileDocument[]>{
 const documents:ProfileDocument[]=[];
 for(const file of PROFILE_FILES){
  let target='';
  let content='';
  let exists=false;
  try{
   target=resolveProfilePath(home,file.id);
   content=await fs.readFile(target,'utf8');
   exists=true;
  }catch(error){
   // A missing file is normal (a fresh profile has no SOUL.md); anything else is reported by the
   // empty content plus exists:false rather than thrown, so one bad file cannot blank the panel.
   exists=exists&&(error as NodeJS.ErrnoException).code!=='ENOENT';
  }
  documents.push({...file,path:target,content,exists});
 }
 return documents;
}

/** Write one document atomically; returns when it is on disk, never before. */
export async function saveProfile(home:string,id:string,text:unknown):Promise<{id:string;path:string;savedAt:string}>{
 const problem=profileWriteError(text);
 if(problem)throw new Error(problem);
 const target=resolveProfilePath(home,id);
 const body=text as string;
 await fs.mkdir(path.dirname(target),{recursive:true});
 const temporary=`${target}.${process.pid}.tmp`;
 await fs.writeFile(temporary,body,'utf8');
 await fs.rename(temporary,target);
 return {id,path:target,savedAt:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})};
}
