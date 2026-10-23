import {build} from 'esbuild';
await build({entryPoints:['src/extension.ts'],bundle:true,platform:'node',format:'cjs',target:'node20',external:['vscode'],outfile:'dist/extension.js',sourcemap:true});
await build({entryPoints:['src/webview/main.ts'],bundle:true,platform:'browser',format:'iife',target:'es2022',outfile:'dist/webview.js',sourcemap:true});
await build({entryPoints:['test/extension-host.ts'],bundle:true,platform:'node',format:'cjs',external:['vscode'],outfile:'out/extension-host.js'});
