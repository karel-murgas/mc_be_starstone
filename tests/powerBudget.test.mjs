import assert from 'node:assert/strict';
import { fixture, drain } from './runtimeFixture.mjs';
const { applyPower, powerStats, PLAN_BATCH, WRITE_BATCH, pendingUnresolved } = await import('../starstone_bp/scripts/powerPropagation.js');

const f = fixture(), refs = new Set();
for (let x=0;x<257;x++) {
    f.put(x===256?'starstone:lamp':'starstone:cable',x,0,0);
    refs.add(`${f.dim.id}|${x}|0|0#main`);
}
let reads=0, maxReads=0, maxWrites=0, maxQueued=0;
const getBlock=f.dim.getBlock;
f.dim.getBlock=p=>{
    assert.equal(f.dim.isChunkLoaded(p),true,'planner never reads an unloaded block');
    reads++; return getBlock(p);
};
const run=globalThis.__mcRun;
globalThis.__mcRun=callback=>run(()=>{
    const beforeReads=reads, beforeWrites=powerStats().appliedWrites;
    callback();
    maxReads=Math.max(maxReads,reads-beforeReads);
    maxWrites=Math.max(maxWrites,powerStats().appliedWrites-beforeWrites);
    maxQueued=Math.max(maxQueued,powerStats().queued);
});

const on=applyPower({nodes:refs,powered:true},f.dim);
assert.equal(reads,0,'large requests do not synchronously scan world nodes');
assert.equal(on.pending,refs.size);
await drain();
assert.equal(on.pending,0);
assert.equal(on.written,refs.size);
assert.ok(maxReads<=PLAN_BATCH,`maximum ${maxReads} reads per callback <= ${PLAN_BATCH}`);
assert.ok(maxWrites<=WRITE_BATCH);
assert.ok(maxQueued<=2*WRITE_BATCH,'planner backpressure bounds concrete write backlog');
assert.equal(powerStats().planning,0);
assert.equal(powerStats().queued,0);
// A lamp hundreds of cables from the source must not sit lit until the
// planner has worked through every preceding cable after a wire break.
const writeOrder=[];
for (let x=0;x<257;x++) {
    const block=getBlock({x,y:0,z:0}), write=block.setPermutation;
    block.setPermutation=function(perm) { writeOrder.push(x); return write.call(this,perm); };
}
const farLamp=`${f.dim.id}|256|0|0#main`;
applyPower({nodes:refs,consumers:new Set([farLamp]),powered:false},f.dim);
await drain();
assert.equal(writeOrder[0],256,'distant lamp is switched off before cable batches');
assert.equal(getBlock({x:256,y:0,z:0}).permutation.getState('starstone:powered'),false);
applyPower({nodes:refs,consumers:new Set([farLamp]),powered:true},f.dim);
await drain();
const before=powerStats().appliedWrites;
const unchanged=applyPower({nodes:refs,powered:true},f.dim);
await drain();
assert.equal(unchanged.written,0);
assert.equal(powerStats().appliedWrites,before,'unchanged large network writes nothing');

const old=applyPower({nodes:refs,powered:false},f.dim);
const newer=applyPower({nodes:refs,powered:true},f.dim);
const one=`${f.dim.id}|100|0|0#main`;
applyPower({nodes:new Set([one]),powered:false},f.dim);
await drain();
assert.equal(old.pending,0,'superseded progress does not stay pending');
assert.equal(newer.pending,0);
for(let x=0;x<257;x++) assert.equal(getBlock({x,y:0,z:0}).permutation.getState('starstone:powered'),x!==100,'small split result supersedes an older large pass');

f.unloaded.add('256,0,0');
const off=applyPower({nodes:refs,powered:false},f.dim);
await drain();
assert.equal(off.unresolved,1);
assert.ok(pendingUnresolved().has(`${f.dim.id}|256|0|0#main`));
f.unloaded.clear();
applyPower({nodes:refs,powered:false},f.dim);
await drain();
assert.equal(getBlock({x:256,y:0,z:0}).permutation.getState('starstone:powered'),false);

const bridge=f.put('starstone:bridge',300,0,0);
const ns=`${f.dim.id}|300|0|0#ns`, ew=`${f.dim.id}|300|0|0#ew`;
applyPower({nodes:new Set([...refs,ns,ew]),powered:true},f.dim);
applyPower({nodes:new Set([ew]),powered:false},f.dim);
await drain();
assert.equal(bridge.permutation.getState('starstone:powered_ns'),true);
assert.equal(bridge.permutation.getState('starstone:powered_ew'),false,'per-state planning keys preserve bridge lane isolation');
let rejectScheduling=false;
globalThis.__mcRun=callback=>{
    if (rejectScheduling) throw new Error('scheduler unavailable');
    return run(callback);
};
applyPower({nodes:refs,powered:false},f.dim);
rejectScheduling=true;
await assert.rejects(drain(),/scheduler unavailable/);
rejectScheduling=false;
applyPower({nodes:refs,powered:false},f.dim);
await drain();
assert.equal(powerStats().planning,0,'scheduler failure does not lock future planning');
assert.equal(powerStats().queued,0,'scheduler failure does not lock future writes');
assert.equal(getBlock({x:0,y:0,z:0}).permutation.getState('starstone:powered'),false);
globalThis.__mcRun=run;
console.log('power budgets: deferred reads, bounded callbacks/backlog, no-op, latest targets, unloaded nodes and bridge lanes passed');
