import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeVga, decodePlanar, rgba, decodeVoc, decodeMusic, decodeAsset, hexDump } from '../src/formats.js';
import { decompressLzhuf } from '../src/lzhuf.js';
import { wavFile } from '../src/audio.js';
const game = new URL('../game/', import.meta.url);

function midi(stream, division = 96) {
  const bytes = new Uint8Array(22 + stream.length); bytes.set([77,84,104,100,0,0,0,6,0,0,0,1,division >> 8,division & 255,77,84,114,107]);
  new DataView(bytes.buffer).setUint32(18, stream.length); bytes.set(stream, 22); return bytes;
}
function cmf(stream) {
  const bytes = new Uint8Array(56 + stream.length), view = new DataView(bytes.buffer); bytes.set([67,84,77,70]);
  for (const [offset, value] of [[4,257],[6,40],[8,56],[10,48],[12,96],[36,1],[38,120]]) view.setUint16(offset,value,true);
  bytes.set(stream,56); return bytes;
}
function voc(samples) {
  const bytes = new Uint8Array(33 + samples.length), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('Creative Voice File\x1a')); view.setUint16(20,26,true); view.setUint16(22,266,true); view.setUint16(24,4393,true);
  bytes[26]=1; const length=samples.length+2; bytes[27]=length&255; bytes[28]=(length>>8)&255; bytes[29]=(length>>16)&255; bytes[30]=166; bytes.set(samples,32); return bytes;
}

test('VGA palette conversion and row-major pixel placement', () => {
  const bytes = new Uint8Array(64768); bytes[321]=7; bytes[64000+21]=63; bytes[64000+22]=32;
  const image=decodeVga(bytes), colors=rgba(image); assert.equal(image.pixels[321],7); assert.equal(colors[321*4],255); assert.equal(colors[321*4+1],130);
  assert.equal(rgba(image, image.palette, true)[3],0); assert.throws(()=>decodeVga(bytes.slice(1)),/Expected/);
});
test('four-plane reconstruction honors plane significance and MSB-first bits', () => {
  const bytes=new Uint8Array(32000); bytes[0]=128; bytes[8000]=64; bytes[16000]=32; bytes[24000]=16;
  assert.deepEqual([...decodePlanar(bytes).pixels.slice(0,5)],[1,2,4,8,0]); assert.throws(()=>decodePlanar(bytes.slice(1)),/Expected/);
});
test('VOC block lengths, sample conversion and WAV header', async () => {
  const bytes=voc([0,128,255]), sound=decodeVoc(bytes); assert.equal(sound.samples[0],-1); assert.equal(sound.samples[1],0); assert.equal(sound.samples[2],127/128);
  assert.equal(sound.sampleRate,1000000/90); assert.equal(sound.duration,3/sound.sampleRate);
  const wav=new DataView(await wavFile(sound).arrayBuffer()); assert.equal(wav.getUint32(40,true),6); assert.equal(wav.getInt16(44,true),-32768);
  assert.throws(()=>decodeVoc(bytes.slice(0,bytes.length-2)),/Truncated/);
  bytes[31]=1; assert.throws(()=>decodeVoc(bytes),/PCM/);
});
test('MIDI running status and a tempo change produce correct note times', () => {
  const music=decodeMusic(midi([0,255,81,3,7,161,32,0,144,60,100,96,60,0,0,255,81,3,15,66,64,0,144,64,100,96,128,64,0,0,255,47,0]));
  assert.equal(music.notes.length,2); assert.equal(music.notes[0].duration,.5); assert.equal(music.notes[1].time,.5); assert.equal(music.notes[1].duration,1); assert.equal(music.duration,1.5);
});
test('sustain holds notes until pedal release and trailing padding is omitted', () => {
  const music=decodeMusic(midi([0,176,64,127,0,144,60,100,96,128,60,0,96,176,64,0,96,255,47,0]));
  assert.equal(music.notes[0].duration,1); assert.equal(music.duration,1); assert.equal(music.streamDuration,1.5);
});
test('parallel MIDI tracks share the conductor tempo', () => {
  const conductor=Uint8Array.from([0,255,81,3,15,66,64,96,255,47,0]);
  const melody=Uint8Array.from([0,144,60,100,96,128,60,0,0,255,47,0]);
  const bytes=new Uint8Array(14+8+conductor.length+8+melody.length), view=new DataView(bytes.buffer);
  bytes.set(midi([]).slice(0,14)); view.setUint16(8,1); view.setUint16(10,2); let offset=14;
  for(const track of [conductor,melody]){bytes.set([77,84,114,107],offset);view.setUint32(offset+4,track.length);bytes.set(track,offset+8);offset+=track.length+8;}
  assert.equal(decodeMusic(bytes).notes[0].duration,1);
});
test('CMF uses its fixed tick clock and resolves its embedded instruments', () => {
  const music=decodeMusic(cmf([0,192,0,0,144,60,127,96,128,60,0,96,255,47,0]),'cmf');
  assert.equal(music.patches.length,1); assert.equal(music.notes[0].duration,1); assert.equal(music.duration,1); assert.equal(music.streamDuration,2);
});
test('malformed music and compression are rejected without reading beyond buffers', () => {
  assert.throws(()=>decodeMusic(midi([0,60,127])),/running status/);
  assert.throws(()=>decodeMusic(midi([128,128,128,128,0])),/four bytes/);
  assert.throws(()=>decodeMusic(midi([0,144,60])),/Truncated/);
  assert.throws(()=>decompressLzhuf(new Uint8Array([1,0,0,0])),/Truncated/);
  assert.throws(()=>decompressLzhuf(new Uint8Array([255,255,255,255])),/Invalid/);
});
test('hex inspection preserves offsets and printable ASCII',()=> {assert.match(hexDump(Uint8Array.from([65,0,66])),/^00000000  41 00 42.*A.B$/);});

test('all 50 original LZHUF files match independently decoded reference hashes', {skip: !existsSync(game)}, async () => {
  const references=JSON.parse(await readFile(new URL('lzhuf-reference.json',import.meta.url),'utf8'));
  for(const reference of references){
    const decoded=decompressLzhuf(new Uint8Array(await readFile(new URL(reference.file,game))));
    assert.equal(decoded.length,reference.size,reference.file); assert.equal(createHash('sha256').update(decoded).digest('hex'),reference.sha256,reference.file);
  }
});
test('every supplied game file has a working preview or inspection view', {skip: !existsSync(game)}, async () => {
  const counts={};
  async function visit(folder,prefix=''){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      if(entry.name.startsWith('.'))continue;
      const path=prefix+entry.name, url=new URL(entry.name+(entry.isDirectory()?'/':''),folder);
      if(entry.isDirectory())await visit(url,path+'/');else {
        const result=decodeAsset(path,new Uint8Array(await readFile(url))); counts[result.kind]=(counts[result.kind]||0)+1;
        if(result.music){assert.ok(result.music.notes.length>0,path); assert.ok(result.music.duration>0,path); assert.ok(result.music.notes.every(note=>Number.isFinite(note.time)&&note.duration>0),path);}
        if(result.sound)assert.ok(result.sound.samples.length>0,path);
      }
    }
  }
  await visit(game); assert.deepEqual(counts,{images:47,music:15,other:27,sounds:27,maps:19});
});
