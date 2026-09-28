import { world, system } from "@minecraft/server";
import { CABLE_ID, KIND_BY_ID } from "./constants.js";
import {
    removeAndSplitNetwork,
    captureRemovedNetworks
} from "./networkController.js";
import { registerCableComponent, schedulePlaced } from "./cableComponent.js";
import { registerGeneratorController } from "./generatorComponent.js";
import { registerDiagnostics } from "./diagnostics.js";
import { registerRecovery } from "./repair.js";
import { placementIndex } from "./persistence.js";
import { registerMutationController } from "./mutationController.js";
import { registerChunkController } from "./chunkController.js";
import { registerRedstoneAdapters } from "./redstoneAdapters.js";
import { registerOreLoot } from "./oreLoot.js";

const TAG = "[Starstone]";

world.afterEvents.worldLoad.subscribe(() => {
    console.log("[Starstone] Starstone active.");
});

// When a Starstone block is added, discover from the new node and merge the
// result into the runtime index: every cached network that shares a node is
// collected and replaced by one component, while unrelated networks are left
// untouched. Cable placement is handled by cableComponent after its connection
// mask has been written; other devices are stable as soon as they are placed.
world.afterEvents.playerPlaceBlock.subscribe((event) => {
    const placed = event.block;
    if (
        !placed ||
        !placed.isValid ||
        placed.type.id === CABLE_ID ||
        KIND_BY_ID[placed.type.id] === undefined
    ) {
        return;
    }
    const dimension = placed.dimension;
    const typeId = placed.type.id;
    const x = Math.floor(placed.location.x);
    const y = Math.floor(placed.location.y);
    const z = Math.floor(placed.location.z);
    system.run(() => {
        try {
            const current = dimension.getBlock({ x, y, z });
            if (!current || !current.isValid || current.type.id !== typeId) {
                return;
            }
            schedulePlaced(current);
        } catch (err) {
            console.warn(`${TAG} Could not merge network after placement: ${err.message}`);
        }
    });
});

// When a Starstone block is removed, its old network must be re-fragmented
// using its cached nodes. The removed type comes from
// event.brokenBlockPermutation, because event.block already holds air or the
// replacement block. Every cached network that references the removed block is
// captured synchronously in the event, then the re-fragmentation is deferred so
// it can safely update surviving blocks. Non-Starstone removals are
// skipped.
world.afterEvents.playerBreakBlock.subscribe((event) => {
    const removed = event.brokenBlockPermutation;
    if (!removed || !removed.type || removed.type.id === undefined) {
        return;
    }
    if (KIND_BY_ID[removed.type.id] === undefined) {
        return;
    }
    const dimension = event.dimension;
    const x = Math.floor(event.block.location.x);
    const y = Math.floor(event.block.location.y);
    const z = Math.floor(event.block.location.z);
    try {
        placementIndex.remove(dimension.id, { x, y, z });
    } catch (err) {
        console.warn(`${TAG} Could not persist removal: ${err.message}`);
    }
    const capture = captureRemovedNetworks(dimension, x, y, z);
    system.run(() => {
        try {
            return removeAndSplitNetwork(capture).catch((err) => {
                console.warn(`${TAG} Could not split network after removal: ${err.message}`);
            });
        } catch (err) {
            console.warn(`${TAG} Could not split network after removal: ${err.message}`);
        }
    });
});

registerCableComponent();

// Task 4.6: react to generator toggles with a power-only recompute of the
// containing network, never a topology rebuild.
registerGeneratorController();

// Task 5.1: expose the bounded /scriptevent diagnostics, rebuild, and debug
// commands to players.
registerDiagnostics();
registerRecovery();
registerMutationController();
registerChunkController();
registerRedstoneAdapters();
registerOreLoot();
