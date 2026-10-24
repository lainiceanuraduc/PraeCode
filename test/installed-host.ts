import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

/** Runs against the PACKAGED VSIX installed in an isolated extensions dir. */
export async function run():Promise<void>{
 const extension=vscode.extensions.getExtension('lainiceanuraduc.radcode-hermes-agent');
 assert.ok(extension,'Packaged extension must be installed');
 const api=await extension.activate();
 await vscode.commands.executeCommand('radcode.open');
 const deadline=Date.now()+20000;
 while(!api.view.isReady&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 assert.equal(api.view.isReady,true,'Packaged webview must load');
 await vscode.commands.executeCommand('radcode.newSession');
 const session=api.controller.active;
 assert.ok(session?.id,'Packaged extension must create an ACP session');
 assert.ok(session.info?.model,'Packaged extension must read live model info');
 let applied='';
 if(session.info.capabilities.values.length){
  applied=session.info.capabilities.values[0];
  await api.controller.setEffort(session.id,applied);
  assert.equal(session.info.effort,applied,'Effort must be confirmed by Hermes');
 }
 await writeFile(path.join(extension.extensionPath,'installed-result.json'),JSON.stringify({ok:true,version:extension.packageJSON.version,editor:vscode.version,webviewReady:api.view.isReady,model:session.info.model,effortApplied:applied,presets:api.presets.list().length},null,2));
 console.log('INSTALLED_OK: packaged VSIX activates, webview ready, ACP session + model + effort verified');
 api.dispose();
}
