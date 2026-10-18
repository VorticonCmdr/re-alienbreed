import test from 'node:test';
import assert from 'node:assert/strict';
import { unpack, pack, validate, floodIndices } from '../src/editor/model.js';
const cells=120*96;
test('editor preserves all bits and trailing bytes through JSON export/import',()=>{
  const bytes=Uint8Array.from({length:cells*2+137},(_,i)=>(i*137+19)&255);
  assert.deepEqual(pack(validate(JSON.parse(JSON.stringify(unpack(bytes,1))))),bytes);
});
test('editor rejects malformed files before they can reach the game',()=>{
  const map=unpack(new Uint8Array(cells*2),1);
  for(const change of [{level:19},{width:119},{tiles:[1]},{types:Array(cells).fill(64)},{reserved:Array(cells).fill(-1)},{extra:[256]},{format:'other'}])assert.throws(()=>validate({...map,...change}));
});
test('flood fill is connected and does not wrap around map rows',()=>{
  const values=Array(cells).fill(1);values[119]=values[120]=0;
  assert.deepEqual(floodIndices(values,119),[119]);
  values[118]=0;assert.deepEqual(floodIndices(values,119),[119,118]);
  assert.equal(floodIndices(Array(cells).fill(0),0).length,cells);
});
