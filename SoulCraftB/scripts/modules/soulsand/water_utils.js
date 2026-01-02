// BP/scripts/modules/water_utils.js

import { world } from '@minecraft/server';

/**
 * Mengecek apakah blok adalah sumber air yang valid untuk dibekukan.
 * Logika Anti-Cheat:
 * Hanya mengizinkan "Source Water" (Level 0) untuk dibekukan.
 * Air mengalir (Stream/Waterfall) dengan level 1-7 akan diabaikan.
 * Ini mencegah pemain membuat generator es tak terbatas dari satu ember air.
 */
export function isFreezeableWaterSource(block, dimension) {
    if (!block || !block.isValid) return false;

    const typeId = block.typeId;
    
    // 1. Filter Tipe Blok: Harus air
    if (typeId !== "minecraft:water" && typeId !== "minecraft:flowing_water") {
        return false;
    }

    // 2. Filter State: Harus Source (Level 0)
    // Di Bedrock, baik 'water' maupun 'flowing_water' memiliki state 'liquid_depth'.
    // Nilai 0 = Source Block.
    // Nilai 1-7 = Flowing levels.
    try {
        const permutation = block.permutation;
        const depth = permutation.getState("liquid_depth");

        // Hanya kembalikan True jika ini adalah Source Murni (0)
        if (depth === 0) {
            return true;
        }
    } catch (e) {
        // Fallback jika terjadi error pengambilan state (jarang terjadi)
        // Jika namanya "minecraft:water" (bukan flowing), biasanya itu source statis.
        if (typeId === "minecraft:water") return true;
    }
    
    return false;
}

/**
 * Helper untuk mengecek apakah ini aliran alami.
 * (Fungsi ini mungkin tidak lagi krusial jika kita sudah memfilter by liquid_depth, 
 * tapi tetap dipertahankan untuk kompatibilitas logika lain jika ada).
 */
export function isNaturalFlowingWater(blockLocation, dimension) {
    return true; 
}