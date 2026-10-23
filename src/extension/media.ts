/**
 * @module media
 * Small, dependency-free helpers shared by the host: JSON that cannot throw on a tool payload and
 * image sniffing that trusts bytes rather than a declared MIME type.
 */

/** Pretty JSON that never throws on a cyclic or exotic tool payload. */
export function safeJson(value:unknown):string{
 const seen=new WeakSet<object>();
 try{
  return JSON.stringify(value,(key,val)=>{
   if(typeof val==='object'&&val!==null){if(seen.has(val as object))return '[circular]';seen.add(val as object);}
   return val;
  },2)??'null';
 }catch{return String(value).slice(0,10_000);}
}

/** Magic-byte check: a declared MIME type is never trusted, the bytes decide. */
export function sniffImage(bytes:Buffer):string|undefined{
 if(bytes.length<12)return undefined;
 if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return 'image/png';
 if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 if(bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP')return 'image/webp';
 if(bytes.subarray(0,4).toString('ascii')==='GIF8')return 'image/gif';
 return undefined;
}
