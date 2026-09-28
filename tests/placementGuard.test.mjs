import assert from 'node:assert/strict';
import { mc, fixture } from './runtimeFixture.mjs';
import { FACE_LIST, supportOffset } from '../starstone_bp/scripts/surfaceFrame.js';
const definitions = new Map();
mc.system.beforeEvents = {startup:{subscribe(callback) {
    callback({blockComponentRegistry:{registerCustomComponent(id,component) {definitions.set(id,component);}}});
}}};
const { registerCableComponent } = await import('../starstone_bp/scripts/cableComponent.js');
registerCableComponent();
const component = definitions.get('starstone:surface');
assert.equal(typeof component.beforeOnPlayerPlace,'function');
assert.equal(typeof definitions.get('starstone:cable').beforeOnPlayerPlace,'function');
assert.equal(typeof definitions.get('starstone:bridge').beforeOnPlayerPlace,'function');

for (const face of FACE_LIST) {
    const f = fixture();
    const [sx,sy,sz] = supportOffset(face);
    const target = f.dim.getBlock({x:0,y:0,z:0});
    function tryPlace() {
        const event = {dimension:f.dim,block:target,face,cancel:false};
        component.beforeOnPlayerPlace(event);
        assert.equal(target.type.id,'minecraft:air','before hook never places then removes the surface');
        return event.cancel;
    }
    f.put('starstone:cable',sx,sy,sz);
    assert.equal(tryPlace(),true,`${face}: cable cannot be a support`);
    f.put('starstone:generator',sx,sy,sz);
    assert.equal(tryPlace(),false,`${face}: full generator face is allowed`);
    f.put('minecraft:stone',sx,sy,sz);
    assert.equal(tryPlace(),false,`${face}: ordinary solid face is allowed`);
    f.unloaded.add(`${sx},${sy},${sz}`);
    assert.equal(tryPlace(),true,`${face}: unavailable support is cancelled`);
}
const f = fixture();
const event = {dimension:f.dim,block:f.dim.getBlock({x:0,y:0,z:0}),face:'invalid',cancel:false};
component.beforeOnPlayerPlace(event);
assert.equal(event.cancel,true);
console.log('placement guard: surface placement cancels invalid/unavailable support before world mutation on all six faces');
