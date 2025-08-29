// BP/scripts/modules/freeze_utils.js

import { world, system, BlockPermutation } from '@minecraft/server';
import { getUniqueKeyFromLocation, isBlockAnchored } from './location_utils';
import { freezeQueues, meltQueues, startQueueProcessor, cancelJobsAtLocation } from './queue_processors';

const MAX_FREEZE_RADIUS = 5;
const MAX_SCAN_BLOCKS = 500;

export class FreezingManager {
    constructor(anchorLocation, dimension, activeMakers) {
        this.anchorLocation = anchorLocation;
        this.dimension = dimension;
        this.activeMakers = activeMakers;
        this.createdIce = new Map();
    }

    trackCreatedIce(location, wasSource) {
        const key = getUniqueKeyFromLocation(location);
        this.createdIce.set(key, { location, wasSource });
    }

    /**
     * FUNGSI BARU: Memindai dan memulihkan data es di sekitar anchor setelah reload.
     */
    repopulateIceDataOnReload() {
        console.log(`[FreezeUtils] Memulihkan data es untuk anchor di ${getUniqueKeyFromLocation(this.anchorLocation)}`);
        for (let x = -MAX_FREEZE_RADIUS; x <= MAX_FREEZE_RADIUS; x++) {
            for (let y = -MAX_FREEZE_RADIUS; y <= MAX_FREEZE_RADIUS; y++) {
                for (let z = -MAX_FREEZE_RADIUS; z <= MAX_FREEZE_RADIUS; z++) {
                    const checkLoc = { 
                        x: this.anchorLocation.x + x, 
                        y: this.anchorLocation.y + y, 
                        z: this.anchorLocation.z + z 
                    };
                    try {
                        const block = this.dimension.getBlock(checkLoc);
                        if (block && block.isValid && block.typeId === 'minecraft:ice') {
                            // Klaim es ini sebagai milik kita. Asumsikan 'wasSource' true sebagai default yang aman.
                            this.trackCreatedIce(block.location, true);
                        }
                    } catch(e) { /* Abaikan chunk tidak dimuat */ }
                }
            }
        }
    }

    triggerSmartFreezeScan(climateVariant, anchorData) {
        cancelJobsAtLocation(this.anchorLocation);

        if (!freezeQueues[climateVariant]) {
            console.warn(`[FreezeUtils] Varian iklim tidak valid: ${climateVariant}`);
            return;
        }

        const blocksToFreeze = [];
        const queue = [{ location: this.anchorLocation, distance: 0 }];
        const visited = new Set([getUniqueKeyFromLocation(this.anchorLocation)]);
        const icePermutation = BlockPermutation.resolve("minecraft:ice");

        const offsets = [
            { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
            { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
            { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }
        ];

        let scannedCount = 0;
        while (queue.length > 0 && scannedCount < MAX_SCAN_BLOCKS) {
            const { location, distance } = queue.shift();
            if (distance >= MAX_FREEZE_RADIUS) continue;

            for (const offset of offsets) {
                const nextLoc = { 
                    x: location.x + offset.x, 
                    y: location.y + offset.y, 
                    z: location.z + offset.z 
                };
                const key = getUniqueKeyFromLocation(nextLoc);
                if (visited.has(key)) continue;
                visited.add(key);
                scannedCount++;

                try {
                    const block = this.dimension.getBlock(nextLoc);
                    if (!block || !block.isValid) continue;
                    const typeId = block.typeId;

                    if (typeId === "minecraft:water" || typeId === "minecraft:flowing_water") {
                        blocksToFreeze.push({ block, permutation: icePermutation, anchorData });
                        queue.push({ location: nextLoc, distance: distance + 1 });
                    } else if (block.isAir) {
                        queue.push({ location: nextLoc, distance: distance + 1 });
                    }
                } catch (e) { /* Abaikan */ }
            }
        }

        if (blocksToFreeze.length > 0) {
            blocksToFreeze.sort((a, b) => {
                const distA = Math.abs(a.block.location.x - this.anchorLocation.x) + Math.abs(a.block.location.y - this.anchorLocation.y) + Math.abs(a.block.location.z - this.anchorLocation.z);
                const distB = Math.abs(b.block.location.x - this.anchorLocation.x) + Math.abs(b.block.location.y - this.anchorLocation.y) + Math.abs(b.block.location.z - this.anchorLocation.z);
                return distA - distB;
            });

            freezeQueues[climateVariant].push(...blocksToFreeze);
            startQueueProcessor();
        }
    }

    triggerMeltProcess(climateVariant, anchorData) {
        cancelJobsAtLocation(this.anchorLocation);

        if (!meltQueues[climateVariant]) {
            console.warn(`[FreezeUtils] Varian iklim tidak valid untuk pencairan: ${climateVariant}`);
            return;
        }
        
        const waterPermutation = BlockPermutation.resolve("minecraft:water");
        const flowingWaterPermutation = BlockPermutation.resolve("minecraft:flowing_water");
        const jobs = [];

        for (const [key, iceData] of this.createdIce.entries()) {
            try {
                if (!isBlockAnchored(iceData.location, this.dimension, this.activeMakers, this.anchorLocation)) {
                    const block = this.dimension.getBlock(iceData.location);
                    if (block && block.isValid && block.typeId === 'minecraft:ice') {
                        jobs.push({
                            block,
                            permutation: iceData.wasSource ? waterPermutation : flowingWaterPermutation,
                            anchorData
                        });
                    }
                }
            } catch(e) { /* Abaikan */ }
        }
        
        this.createdIce.clear();
        if (jobs.length > 0) {
            meltQueues[climateVariant].push(...jobs);
            startQueueProcessor();
        }
    }
}
