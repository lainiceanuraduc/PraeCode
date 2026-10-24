/**
 * @module Settings
 * Everything the extension reads from `radcode.*` that is not a plain string, plus the validation
 * those values need before they can reach Hermes or the webview.
 */
import * as vscode from 'vscode';

export interface Appearance {accent:string;fontSize:number;lineHeight:number;compact:boolean;}

 /**
  * MCP servers are configuration, not code: they are passed to session/new exactly as ACP defines
  * them (stdio = command/args/env, http/sse = url/headers), so Hermes registers their tools for the
  * session. Blank or malformed entries are refused instead of silently ignored.
  */
export function mcpServers():Record<string,unknown>[]{
  const configured=vscode.workspace.getConfiguration('radcode').get<unknown[]>('mcpServers',[]);
  if(!Array.isArray(configured))return [];
  return configured.map((entry,index)=>{
   const server=entry as Record<string,unknown>;
   if(!server||typeof server!=='object')throw new Error(`MCP server #${index+1} must be an object`);
   const name=typeof server.name==='string'?server.name.trim():'';
   if(!name||!/^[\w.-]{1,64}$/.test(name))throw new Error(`MCP server #${index+1} needs a name (letters, digits, . _ -)`);
   const env=(raw:unknown):Record<string,string>|undefined=>{
    if(raw===undefined)return undefined;
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error(`MCP server "${name}": env/headers must be an object`);
    return Object.fromEntries(Object.entries(raw as Record<string,unknown>).map(([k,v])=>[k,String(v)]));
   };
   if(typeof server.url==='string'&&server.url.trim()){
    const url=server.url.trim();
    if(!/^https?:\/\//i.test(url))throw new Error(`MCP server "${name}": url must be http(s)`);
    return {name,url,headers:env(server.headers)??{}};
   }
   // A stdio server resolves its command through PATH, exactly like Hermes' own config does.
   if(typeof server.command!=='string'||!server.command.trim())throw new Error(`MCP server "${name}" needs a command or a url`);
   if(server.args!==undefined&&!Array.isArray(server.args))throw new Error(`MCP server "${name}": args must be an array`);
   return {name,command:server.command.trim(),args:(server.args??[]).map(String),env:env(server.env)??{}};
  });
 }

 /** Appearance settings travel with every state push, so changes apply without a reload. */
export function appearance(fallbackFontSize?:number):Appearance{
  const c=vscode.workspace.getConfiguration('radcode');
  // When the running manifest predates `radcode.fontSize`, the configured value reads as the
  // default; the caller passes the value mirrored in extension state so the slider still holds.
  const configured=c.get<number>('fontSize',0);
  const fontSize=clampTextSize(configured>0?configured:(fallbackFontSize??10));
  return {accent:c.get<string>('accent','yellow'),
          fontSize,lineHeight:c.get<number>('lineHeight',0),compact:c.get<boolean>('compact',false)};
 }

/** One clamp, shared by the settings reader and the text-size command. */
export function clampTextSize(value:number):number{
 const n=Math.round(Number(value));
 return Number.isFinite(n)?Math.min(30,Math.max(1,n)):13;
}
