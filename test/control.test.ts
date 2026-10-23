import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {HermesControl} from '../src/infrastructure/HermesControl';

test('control helper passes structured input without shell interpolation', async()=>{
 const service=new HermesControl(process.execPath,'test/fixtures/control.cjs',undefined,process.execPath);
 const result=await service.catalog('provider; echo unsafe','model with spaces');
 assert.deepEqual(result.values,['low','high']);
 assert.equal(result.note,'provider; echo unsafe:model with spaces');
});
