import assert from 'node:assert/strict';
import { blockKey, nodeRef, parseBlockKey, parseNodeRef } from '../starstone_bp/scripts/blockKeys.js';
const p = { x:-17,y:-64,z:16 };
assert.equal(blockKey('minecraft:overworld',p),'minecraft:overworld|-17|-64|16');
assert.deepEqual(parseNodeRef(nodeRef('minecraft:overworld',p,'ew')), { dimensionId:'minecraft:overworld',...p,lane:'ew' });
for (const key of ['x|NaN|0|0','x|0.5|0|0','x|0|0|0|1','x|01|0|0','x|9007199254740992|0|0']) assert.equal(parseBlockKey(key),undefined);
for (const ref of ['x|0|0|0','x|0|0|0#bad','x|0|0|0#ns#ew']) assert.equal(parseNodeRef(ref),undefined);
assert.throws(() => nodeRef('x',p,'bad'));
