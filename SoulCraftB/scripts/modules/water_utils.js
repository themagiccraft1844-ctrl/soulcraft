// BP/scripts/modules/water_utils.js

import { world } from '@minecraft/server'; // Hanya untuk type hints dan mungkin debug jika diperlukan

/**
 * Helper function untuk mengecek apakah blok air adalah "sumber air sejati" atau "puncak air terjun" yang bisa dibekukan.
 * @param {import("@minecraft/server").Vector3} blockLocation - Lokasi blok air yang akan dicek.
 * @param {import("@minecraft/server").Dimension} dimension - Dimensi tempat blok berada.
 * @param {number} [depth=0] - Kedalaman rekursi untuk mencegah loop tak terbatas.
 * @returns {boolean} True jika blok air adalah sumber sejati yang bisa dibekukan, false jika tidak.
 */
export function isFreezeableWaterSource(blockLocation, dimension, depth = 0) {
    if (depth > 5) { // Batasi kedalaman rekursi
        return true; // Asumsikan bisa dibekukan jika rekursi terlalu dalam
    }

    const horizontalOffsets = [
        { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }
    ];

    let hasHorizontalAirOrFlowingWater = false;
    for (const offset of horizontalOffsets) {
        const adjacentLoc = { x: blockLocation.x + offset.x, y: blockLocation.y + offset.y, z: blockLocation.z + offset.z };
        try {
            // Gunakan getBlockFromLocation
            const adjacentBlock = dimension.getBlockFromLocation(adjacentLoc);
            if (adjacentBlock && adjacentBlock.isValid && (adjacentBlock.typeId === "minecraft:air" || adjacentBlock.typeId === "minecraft:flowing_water")) {
                hasHorizontalAirOrFlowingWater = true;
                break;
            }
        } catch (e) { /* ignore errors from unloaded chunks */ }
    }

    const blockBelowLoc = { x: blockLocation.x, y: blockLocation.y - 1, z: blockLocation.z };
    let hasAirOrFlowingWaterBelow = false;
    try {
        // Gunakan getBlockFromLocation
        const blockBelow = dimension.getBlockFromLocation(blockBelowLoc);
        if (blockBelow && blockBelow.isValid && (blockBelow.typeId === "minecraft:air" || blockBelow.typeId === "minecraft:flowing_water")) {
            hasAirOrFlowingWaterBelow = true;
        }
    } catch (e) { /* ignore errors from unloaded chunks */ }

    // Logika 1: Sumber air statis sejati (kolam)
    if (!hasHorizontalAirOrFlowingWater && !hasAirOrFlowingWaterBelow) {
        return true;
    }

    // Logika 2: Puncak Air Terjun (Waterfall Peak)
    if (hasAirOrFlowingWaterBelow && !hasHorizontalAirOrFlowingWater) {
        const blockAboveLoc = { x: blockLocation.x, y: blockLocation.y + 1, z: blockLocation.z };
        try {
            // Gunakan getBlockFromLocation
            const blockAbove = dimension.getBlockFromLocation(blockAboveLoc);
            if (blockAbove && blockAbove.isValid && (blockAbove.typeId === "minecraft:water" || blockAbove.typeId === "minecraft:flowing_water")) {
                // Rekursif: Jika blok di atas adalah sumber yang bisa dibekukan, maka blok saat ini bukan puncak
                if (isFreezeableWaterSource(blockAboveLoc, dimension, depth + 1)) {
                    return false;
                }
            }
        } catch (e) { /* ignore errors from unloaded chunks */ }
        return true; // Jika tidak ada air di atas atau air di atas bukan sumber, ini adalah puncak
    }

    // Logika 3: Air di genangan yang memiliki satu sisi terbuka (misal lubang 1x2)
    if (hasHorizontalAirOrFlowingWater && !hasAirOrFlowingWaterBelow) {
        let openHorizontalSides = 0;
        for (const offset of horizontalOffsets) {
            const adjacentLoc = { x: blockLocation.x + offset.x, y: blockLocation.y + offset.y, z: blockLocation.z + offset.z };
            try {
                // Gunakan getBlockFromLocation
                const adjacentBlock = dimension.getBlockFromLocation(adjacentLoc);
                if (adjacentBlock && adjacentBlock.isValid && (adjacentBlock.typeId === "minecraft:air" || adjacentBlock.typeId === "minecraft:flowing_water")) {
                    openHorizontalSides++;
                }
            } catch (e) { /* ignore errors from unloaded chunks */ }
        }
        if (openHorizontalSides === 1) { // Hanya satu sisi terbuka
            return true;
        }
    }
    return false;
}

/**
 * Helper function untuk mengecek apakah blok flowing_water adalah aliran alami (bukan player-placed).
 * @param {import("@minecraft/server").Vector3} blockLocation - Lokasi blok flowing_water yang akan dicek.
 * @param {import("@minecraft/server").Dimension} dimension - Dimensi tempat blok berada.
 * @returns {boolean} True jika flowing_water adalah aliran alami, false jika kemungkinan player-placed.
 */
export function isNaturalFlowingWater(blockLocation, dimension) {
    const checkOffsets = [
        { x: 0, y: -1, z: 0 }, // Bawah
        { x: 1, y: 0, z: 0 },  // Timur
        { x: -1, y: 0, z: 0 }, // Barat
        { x: 0, y: 0, z: 1 },  // Selatan
        { x: 0, y: 0, z: -1 }   // Utara
    ];

    for (const offset of checkOffsets) {
        const adjacentLoc = { x: blockLocation.x + offset.x, y: blockLocation.y + offset.y, z: blockLocation.z + offset.z };
        try {
            // Gunakan getBlockFromLocation
            const adjacentBlock = dimension.getBlockFromLocation(adjacentLoc);
            if (adjacentBlock && adjacentBlock.isValid && (adjacentBlock.typeId === "minecraft:air" || adjacentBlock.typeId === "minecraft:flowing_water")) {
                return true; // Jika ada udara atau air mengalir di sekitar, kemungkinan alami
            }
        } catch (e) { /* ignore errors from unloaded chunks */ }
    }
    return false;
}
