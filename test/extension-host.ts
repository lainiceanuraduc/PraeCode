/**
 * End-to-end harness, run inside a real editor:
 *
 *   npm run compile
 *   xvfb-run -a codium --extensionDevelopmentPath="$PWD" \
 *     --extensionTestsPath="$PWD/out/extension-host.js" "$PWD"
 *
 * It asserts what unit tests cannot: that the extension activates, its commands are registered, the
 * webview really loads and reports ready, a live ACP session is created with a model identity, an
 * effort change is read back from Hermes, and the change-review surface is present.
 *
 * A result file is written even on failure — the editor used to exit 0 with no output, which made a
 * broken run indistinguishable from a passing one.
 */
import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

interface Result {
  ok: boolean;
  editor?: string;
  webviewReady?: boolean;
  sessionId?: string;
  model?: string;
  effort?: string;
  review?: {listed: number; blocker: string | undefined; command: boolean};
  testedAt: string;
  error?: string;
}

export async function run():Promise<void>{
  const result:Result={ok:false,testedAt:new Date().toISOString()};
  let api:any;
  try{
    const extension=vscode.extensions.getExtension('lainiceanuraduc.praecode');
    assert.ok(extension,'Development extension must be present in the test host');
    api=await extension.activate();
    result.editor=vscode.version;
    const commands=await vscode.commands.getCommands(true);
    for(const name of ['radcode.open','radcode.newSession','radcode.model','radcode.attachSelection','radcode.reviewChanges']){
      assert.ok(commands.includes(name),name);
    }
    await vscode.commands.executeCommand('radcode.open');
    const deadline=Date.now()+20000;
    while(!api.view.isReady&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
    assert.equal(api.view.isReady,true,'Webview JavaScript must finish loading and send ready');
    result.webviewReady=api.view.isReady;

    await vscode.commands.executeCommand('radcode.newSession');
    const controller=api.controller;
    assert.ok(controller.active?.id,'A real ACP session must be created');
    assert.ok(controller.active.info?.model,'Live model identity must be returned');
    const session=controller.active;
    result.sessionId=session.id;
    result.model=session.info.model;
    if(session.info.capabilities.values.length){
      const value=session.info.capabilities.values[0];
      await controller.setEffort(session.id,value);
      assert.equal(session.info.effort,value,'Effort must be read back from Hermes');
      result.effort=session.info.effort;
    }

    // Change review is wired: the journal is reachable and its guards answer for a real workspace path.
    const root=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath??'';
    assert.ok(root,'The host must open a workspace folder');
    assert.ok(Array.isArray(api.changes.list()),'The review journal must answer');
    result.review={listed:api.changes.list().length,blocker:api.changes.blocker(path.join(root,'package.json')),
      command:commands.includes('radcode.reviewChanges')};

    result.ok=true;
  }catch(error){
    result.error=error instanceof Error?`${error.message}`:String(error);
    throw error;
  }finally{
    const target=path.join(vscode.extensions.getExtension('lainiceanuraduc.praecode')?.extensionPath??process.cwd(),
      'docs','extension-host-result.json');
    await writeFile(target,JSON.stringify(result,null,2)).catch(()=>{});
    console.log(result.ok?'EXTENSION_HOST_OK':'EXTENSION_HOST_FAILED',JSON.stringify(result));
  }
}
