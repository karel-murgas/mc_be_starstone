// generatorComponent.js
//
// Task 4.6 — react to generator toggles without rebuilding topology.
//
// A generator's `enabled` flag is the network's only source flag. Toggling it
// must recompute the CONTAINING network's `powered` value and write power only
// when that value changes. This module never calls discoverNetwork(): it finds
// the owning network straight from the runtime node->network index
// (networkIdOf), recomputes power from that network's stored sources through
// anySourceOn (each source block's state read once, no edge walking), and calls
// applyPower only on a real change. Repeated toggles therefore cost no
// topology traversal.

import { system } from "@minecraft/server";
import runtime, { isCompleteNetwork } from "./networkRuntime.js";
import { anySourceOn } from "./networkController.js";
import { applyPower } from "./powerPropagation.js";
import { GENERATOR_ID, STATE_ENABLED } from "./constants.js";
import { sourceChanged } from "./networkEvents.js";

const TAG = "[Starstone]";

// The generator exposes one joined source lane, #main.
const GEN_LANE = "main";

// The NodeRef a generator contributes to a network: its single main lane.
function generatorNodeRef(dimension, x, y, z) {
    return `${dimension.id}|${Math.floor(x)}|${Math.floor(y)}|${Math.floor(z)}#${GEN_LANE}`;
}

// Recompute the containing network's powered value after a generator toggle and
// apply power only when it changed. The owning network is found from the runtime
// index (networkIdOf), never by discovering, so this is an index lookup plus a
// per-source state read — no graph walk. Returns { id, changed, powered } or
// undefined when the generator owns no cached network.
export function reactToGeneratorToggle(dimension, x, y, z) {
    const ref = generatorNodeRef(dimension, x, y, z);
    const id = runtime.networkIdOf(ref);
    const previous = id === undefined ? undefined : runtime.networkOf(id)?.powered;
    const block = dimension.getBlock({ x, y, z });
    const committed = block?.isValid &&
        sourceChanged(dimension, { x, y, z }, Boolean(block.permutation.getState(STATE_ENABLED)));
    if (id === undefined) {
        return undefined;
    }
    const network = runtime.networkOf(id);
    if (!network) {
        return undefined;
    }
    // Saved metadata decides only for a network that reaches unloaded chunks;
    // a fully loaded one is recomputed from its own sources right here.
    if (committed && !isCompleteNetwork(network, dimension)) {
        return { id, changed: previous !== network.powered, powered: network.powered };
    }
    const powered = anySourceOn(network, dimension);
    if (powered === Boolean(network.powered)) {
        return { id, changed: false, powered };
    }
    network.powered = powered;
    applyPower(network, dimension);
    return { id, changed: true, powered };
}

// Interaction changes the state and immediately updates the existing network.
// Other scripts changing STATE_ENABLED must call reactToGeneratorToggle too.
export function registerGeneratorController() {
    system.beforeEvents.startup.subscribe((event) => {
        event.blockComponentRegistry.registerCustomComponent("starstone:generator", {
            onPlayerInteract({ block }) {
                if (!block || !block.isValid || block.type.id !== GENERATOR_ID) return;
                try {
                    const enabled = Boolean(block.permutation.getState(STATE_ENABLED));
                    block.setPermutation(block.permutation.withState(STATE_ENABLED, !enabled));
                    const { x, y, z } = block.location;
                    reactToGeneratorToggle(block.dimension, x, y, z);
                } catch (err) {
                    console.warn(`${TAG} Could not toggle generator: ${err.message}`);
                }
            }
        });
    });
}

export { generatorNodeRef };
