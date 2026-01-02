// BP/scripts/modules/freeze_utils.js

import { world, system, BlockPermutation } from '@minecraft/server';
import { getUniqueKeyFromLocation, isBlockAnchored, distanceSquared } from './location_utils.js';
import { isFreezeableWaterSource } from './water_utils.js';
import { registerRandomTickJob, unregisterRandomTickJob } from './queue_processors.js';
import { isCandidateBlocked } from './blocked_candidate_block.js'; // IMPORT BARU

const MAX_FREEZE_RADIUS = 5;

// Konfigurasi kecepatan (Peluang terjadi per random tick check)
const FREEZE_CHANCE = {
    warm: 0.02,      // Sangat lambat/hampir tidak mungkin terjadi di biome panas
    temperate: 0.10, // Kecepatan sedang untuk biome normal
    cold: 0.35       // Cepat tapi tidak instan untuk biome dingin
};

// Konfigurasi kecepatan Pencairan (UPDATED: INSTAN/AGRESIF)
const MELT_CHANCE = {
    warm: 0.85,      // Sangat Instan di tempat panas (85% peluang per tick)
    temperate: 0.60, // Cepat di tempat biasa
    cold: 0.0        // [PENTING] 0% Mencair di biome dingin. Es akan abadi.
};

export class FreezingManager {
    constructor(anchorLocation, dimension, activeMakers) {
        this.anchorLocation = anchorLocation;
        this.dimension = dimension;
        this.activeMakers = activeMakers;
        
        this.currentTarget = null; 
        this.isFreezing = false;
        this.activeClimate = "temperate";
    }

    triggerSmartFreezeScan(climateVariant) {
        this.activeClimate = climateVariant;
        this.isFreezing = true; 
        this._findNextTarget();
    }

    triggerMeltProcess(climateVariant) {
        this.activeClimate = climateVariant;
        this.isFreezing = false; 
        this._findNextTarget();
    }

    _findNextTarget() {
        unregisterRandomTickJob(getUniqueKeyFromLocation(this.anchorLocation));
        this.currentTarget = null;

        const maxRange = MAX_FREEZE_RADIUS;
        
        const startR = this.isFreezing ? 1 : maxRange;
        const endR = this.isFreezing ? maxRange : 1;
        const step = this.isFreezing ? 1 : -1;
        
        for (let r = startR; (this.isFreezing ? r <= endR : r >= endR); r += step) {
            let candidates = [];

            for (let x = -r; x <= r; x++) {
                for (let y = -r; y <= r; y++) {
                    for (let z = -r; z <= r; z++) {
                        if (Math.abs(x) !== r && Math.abs(y) !== r && Math.abs(z) !== r) continue;

                        const targetLoc = {
                            x: this.anchorLocation.x + x,
                            y: this.anchorLocation.y + y,
                            z: this.anchorLocation.z + z
                        };

                        try {
                            const block = this.dimension.getBlock(targetLoc);
                            if (!block || !block.isValid) continue;

                            if (this.isFreezing) {
                                // LOGIKA PEMBEKUAN
                                if (isFreezeableWaterSource(block, this.dimension)) {
                                    // [FITUR BARU] Cek apakah jalur suhu dingin terblokir?
                                    // Jika terblokir, jangan masukkan ke kandidat (skip).
                                    if (!isCandidateBlocked(block, this.anchorLocation, this.dimension)) {
                                        candidates.push(block);
                                    }
                                }
                            } else {
                                // LOGIKA PENCAIRAN
                                if (block.typeId === "minecraft:ice") {
                                    if (!isBlockAnchored(targetLoc, this.dimension, this.activeMakers, this.anchorLocation)) {
                                        // Untuk pencairan, kita asumsikan panas lingkungan yang bekerja, 
                                        // jadi tidak perlu cek blocked line of sight dari ESS (karena ESS-nya sudah hancur/hilang).
                                        candidates.push(block);
                                    }
                                }
                            }
                        } catch (e) { /* Chunk unloaded */ }
                    }
                }
            }

            if (candidates.length > 0) {
                const luckyOne = candidates[Math.floor(Math.random() * candidates.length)];
                
                this.currentTarget = {
                    location: luckyOne.location,
                    expectedType: this.isFreezing ? ["minecraft:water", "minecraft:flowing_water"] : ["minecraft:ice"]
                };

                registerRandomTickJob(getUniqueKeyFromLocation(this.anchorLocation), this);
                return; 
            }
        }
    }

    executeRandomTick() {
        if (!this.currentTarget) return false;

        const chance = this.isFreezing ? FREEZE_CHANCE[this.activeClimate] : MELT_CHANCE[this.activeClimate];
        
        if (chance <= 0) {
            unregisterRandomTickJob(getUniqueKeyFromLocation(this.anchorLocation));
            return false;
        }
        
        if (Math.random() > chance) {
            return false; 
        }

        try {
            const block = this.dimension.getBlock(this.currentTarget.location);
            if (!block || !block.isValid) {
                this._findNextTarget();
                return false;
            }

            if (this.isFreezing) {
                if (isFreezeableWaterSource(block, this.dimension)) {
                    // Cek validasi terakhir sebelum eksekusi (opsional tapi aman)
                    if (!isCandidateBlocked(block, this.anchorLocation, this.dimension)) {
                        block.setPermutation(BlockPermutation.resolve("minecraft:ice"));
                        this._findNextTarget();
                        return true;
                    } else {
                        // Jika tiba-tiba terblokir (player taruh blok pas scanning), cari target lain
                        this._findNextTarget();
                        return false;
                    }
                }
            } else {
                if (block.typeId === "minecraft:ice") {
                    if (!isBlockAnchored(block.location, this.dimension, this.activeMakers, this.anchorLocation)) {
                        block.setPermutation(BlockPermutation.resolve("minecraft:flowing_water"));
                        this._findNextTarget();
                        return true;
                    }
                }
            }
        } catch (e) { }

        this._findNextTarget();
        return false;
    }
}