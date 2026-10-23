/**
 * Extension entry point.
 *
 * `activate` only constructs the composition root (see `./extension/RadCodeExtension.ts`); keeping
 * this file tiny makes the activation surface obvious and the build a single entry point.
 */
import type * as vscode from 'vscode';
import {RadCodeExtension} from './extension/RadCodeExtension';

let extension:RadCodeExtension|undefined;

export function activate(context:vscode.ExtensionContext):RadCodeExtension{
 extension=new RadCodeExtension(context);
 context.subscriptions.push(extension);
 return extension;
}

export function deactivate():void{
 extension?.dispose();
 extension=undefined;
}
