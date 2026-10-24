import * as vscode from 'vscode';
import assert from 'node:assert/strict';

export async function run():Promise<void>{
 const extension=vscode.extensions.getExtension('lainiceanuraduc.praecode');
 assert.ok(extension,'Development extension must be installed in the test host');
 const api=await extension.activate();
 const commands=await vscode.commands.getCommands(true);
 for(const name of ['radcode.open','radcode.newSession','radcode.model','radcode.attachSelection'])assert.ok(commands.includes(name),name);
 await vscode.commands.executeCommand('radcode.open');
 const deadline=Date.now()+20000;
 while(!api.view.isReady&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
 assert.equal(api.view.isReady,true,'Webview JavaScript must finish loading and send ready');
 await vscode.commands.executeCommand('radcode.newSession');
 const controller=api.controller;
 assert.ok(controller.active?.id,'Real ACP session must be created');
 assert.ok(controller.active.info?.model,'Live model identity must be returned');
 const session=controller.active;
 if(session.info.capabilities.values.length){
  const value=session.info.capabilities.values[0];
  await controller.setEffort(session.id,value);
  assert.equal(session.info.effort,value,'Effort must be read back from Hermes');
 }
 console.log('EXTENSION_HOST_OK: commands registered, webview ready, real ACP session and effort read-back verified');
 await (await import('node:fs/promises')).writeFile(extension.extensionPath+'/docs/extension-host-result.json',JSON.stringify({ok:true,editor:vscode.version,webviewReady:api.view.isReady,sessionId:session.id,model:session.info.model,effort:session.info.effort,testedAt:new Date().toISOString()},null,2));
 api.dispose();
}
