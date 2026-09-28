import assert from 'node:assert/strict';
import { fixture, drain } from './runtimeFixture.mjs';
import { FACE_LIST, supportOffset, worldOffset } from '../starstone_bp/scripts/surfaceFrame.js';
import { supportMountAllowed, SUPPORT_SHAPE } from '../starstone_bp/scripts/supportPolicy.js';
const { isSupportValid } = await import('../starstone_bp/scripts/support.js');
const { readAdjacentRedstone, pollInputs, trackInput } = await import('../starstone_bp/scripts/redstoneAdapters.js');
const { discoverAndRegisterNetwork } = await import('../starstone_bp/scripts/networkController.js');
const { refreshCable } = await import('../starstone_bp/scripts/cableComponent.js');
const runtime = (await import('../starstone_bp/scripts/networkRuntime.js')).default;
const surfaceIds = ['starstone:cable','starstone:bridge','starstone:lamp','starstone:redstone_input','starstone:redstone_output'];
assert.equal(supportMountAllowed(SUPPORT_SHAPE.FULL,'invalid'),false,'only real full faces can support a surface');

for (const face of FACE_LIST) {
    for (const id of surfaceIds) {
        const f = fixture(); f.dim.id = `test:mount-${face}-${id.slice(10)}`;
        const [sx,sy,sz] = supportOffset(face);
        const source = f.put('starstone:generator',sx,sy,sz);
        source.permutation.isLiquidBlocking = () => false;
        const surface = f.put(id,0,0,0,{'minecraft:block_face':face});
        assert.equal(isSupportValid(surface),true,`${id} mounts to generator ${face}`);
        for (const thin of surfaceIds) {
            const other = f.put(thin,sx,sy,sz);
            other.permutation.isLiquidBlocking = () => true;
            assert.equal(isSupportValid(surface),false,`${id} must not mount to ${thin} ${face}`);
        }
        f.put('starstone:conduit',sx,sy,sz);
        assert.equal(isSupportValid(surface),true,`${id} mounts to full conduit ${face}`);
    }

    // Input receives from a full generator on its back face and from a cable
    // beside it, all on the same surface plane. This is real graph traversal.
    runtime.clearNetworks();
    const f = fixture(); f.dim.id = `test:contacts-${face}`;
    const [sx,sy,sz] = supportOffset(face);
    const [tx,ty,tz] = worldOffset(face,'local_e');
    f.put('starstone:generator',sx,sy,sz);
    const input = f.put('starstone:redstone_input',0,0,0,{'minecraft:block_face':face});
    const cable = f.put('starstone:cable',tx,ty,tz,{'minecraft:block_face':face});
    f.put('minecraft:stone',tx+sx,ty+sy,tz+sz);
    refreshCable(cable);
    const pending = discoverAndRegisterNetwork(input); await drain(); const network = await pending;
    assert.ok(network.nodes.has(`${f.dim.id}|${sx}|${sy}|${sz}#main`),`${face} back contact`);
    assert.ok(network.nodes.has(`${f.dim.id}|${tx}|${ty}|${tz}#main`),`${face} tangent cable contact`);
    assert.ok(network.nodes.has(`${f.dim.id}|0|0|0#main`));
    // A full source beside (rather than behind) the adapter is also a direct
    // reciprocal contact. It must not require cable between the two devices.
    runtime.clearNetworks();
    f.put('starstone:generator',tx,ty,tz);
    const tangentPending = discoverAndRegisterNetwork(input); await drain();
    assert.ok((await tangentPending).nodes.has(`${f.dim.id}|${tx}|${ty}|${tz}#main`),`${face} tangent source contact`);

    // An unpowered support does not veto a powered touching redstone device.
    const support = f.dim.getBlock({x:sx,y:sy,z:sz}); support.getRedstonePower = () => 0;
    const neighbor = f.put('minecraft:redstone_block',tx,ty,tz); neighbor.getRedstonePower = () => 15;
    assert.deepEqual(readAdjacentRedstone(input),{on:true,complete:true},`${face} adjacent drive`);
    trackInput(input); pollInputs(); await drain();
    assert.equal(input.permutation.getState('starstone:powered'),true,`${face} input transition`);
    neighbor.getRedstonePower = () => 0;
    pollInputs(); await drain();
    assert.equal(input.permutation.getState('starstone:powered'),false,`${face} turns off only after full sample`);
    f.unloaded.add(`${tx},${ty},${tz}`);
    assert.deepEqual(readAdjacentRedstone(input),{on:false,complete:false});
    support.getRedstonePower = () => 15;
    assert.equal(readAdjacentRedstone(input).on,true,`${face} loaded support can drive despite unavailable side`);
    f.unloaded.clear();
}
console.log('support and contacts: all six faces, full Starstone supports, thin rejection, graph back/tangent contact and adjacent redstone passed');
