/**
 * @module HermesProfile
 * The parts of a Hermes profile the Features tab may read and write, and the rules that keep a
 * write inside that profile. An allowlist, never a path from the webview: the same reason the
 * composer only sends paths the host validated.
 */
import path from 'node:path';

export interface ProfileFile {id:string;title:string;relativePath:string;description:string;}

/** Editable profile documents. Deliberately small: config.yaml can break Hermes, memory cannot. */
export const PROFILE_FILES:ProfileFile[]=[
 {id:'soul',title:'SOUL.md',relativePath:'SOUL.md',
  description:'Persona and standing instructions Hermes loads for every session.'},
 {id:'user',title:'User memory',relativePath:'memories/USER.md',
  description:'What Hermes remembers about you: role, style, standing preferences.'},
 {id:'memory',title:'Agent memory',relativePath:'memories/MEMORY.md',
  description:'Hermes\u2019 own notes: environment facts, conventions, lessons learned.'}
];

/** A memory file is text; past a quarter megabyte it is a mistake, not a note. */
export const MAX_PROFILE_BYTES=256*1024;

export function profileFile(id:string):ProfileFile{
 const file=PROFILE_FILES.find(entry=>entry.id===id);
 if(!file)throw new Error('Unknown profile file');
 return file;
}

/** Absolute path of an allowlisted profile file, refused if it would land outside the profile. */
export function resolveProfilePath(home:string,id:string):string{
 const file=profileFile(id);
 if(!home||!path.isAbsolute(home))throw new Error('Set radcode.hermesHome to an absolute profile path first');
 const base=path.resolve(home);
 const target=path.resolve(base,file.relativePath);
 if(target!==base&&!target.startsWith(base+path.sep))throw new Error('Profile path escapes the Hermes profile');
 return target;
}

/** Human-readable reason a save must be refused, or '' when the text may be written. */
export function profileWriteError(text:unknown):string{
 if(typeof text!=='string')return 'Profile content must be text';
 if(Buffer.byteLength(text,'utf8')>MAX_PROFILE_BYTES)return `Profile files are limited to ${MAX_PROFILE_BYTES} bytes`;
 return '';
}
