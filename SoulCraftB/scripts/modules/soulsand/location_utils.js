// BP/scripts/modules/location_utils.js

import { world } from '@minecraft/server';

/**
 * Helper function untuk menghitung jarak kuadrat antara dua lokasi.
 * @param {import("@minecraft/server").Vector3} loc1
 * @param {import("@minecraft/server").Vector3} loc2
 * @returns {number} Jarak kuadrat.
 */
export function distanceSquared(loc1, loc2) {
    if (!loc1 || !loc2 || typeof loc1.x !== 'number' || typeof loc1.y !== 'number' || typeof loc1.z !== 'number' ||
        typeof loc2.x !== 'number' || typeof loc2.y !== 'number' || typeof loc2.z !== 'number') {
        console.error(`[ERROR] Invalid location data in distanceSquared: loc1=${JSON.stringify(loc1)}, loc2=${JSON.stringify(loc2)}`);
        return NaN;
    }
    const dx = loc1.x - loc2.x;
    const dy = loc1.y - loc2.y;
    const dz = loc1.z - loc2.z;
    return dx * dx + dy * dy + dz * dz;
}

/**
 * Helper function untuk mengecek apakah sebuah blok masih memiliki anchor BLOCK_ID di radius tertentu.
 * @param {import("@minecraft/server").Vector3} checkBlockLocation - Lokasi blok yang akan dicek.
 * @param {import("@minecraft/server").Dimension} dimension - Dimensi tempat blok berada.
 * @param {Map<string, any>} activeMakers - Map global yang menyimpan data anchor aktif.
 * @param {import("@minecraft/server").Vector3 | null} excludeBlockLocation - Lokasi anchor yang harus diabaikan.
 * @param {number} [radius=5] - Radius pencarian anchor.
 * @returns {boolean} True jika anchor ditemukan, false jika tidak.
 */
export function isBlockAnchored(checkBlockLocation, dimension, activeMakers, excludeBlockLocation = null, radius = 5) {
    const anchorCheckRadiusSquared = radius * radius;
    for (const [key, makerData] of activeMakers.entries()) {
        const makerLocation = makerData.location;
        const makerDimension = makerData.dimension;

        if (makerDimension.id !== dimension.id) continue;
        if (excludeBlockLocation && makerLocation.x === excludeBlockLocation.x && makerLocation.y === excludeBlockLocation.y && makerLocation.z === excludeBlockLocation.z) {
            continue;
        }

        try {
            const distSq = distanceSquared(checkBlockLocation, makerLocation);
            if (!isNaN(distSq) && distSq <= anchorCheckRadiusSquared) {
                return true;
            }
        } catch (e) {
            console.error(`[ERROR] Error calculating distance in isBlockAnchored: ${e.message}`);
        }
    }
    return false;
}

/**
 * Helper function untuk membuat string kunci unik dari lokasi.
 * Lebih defensif terhadap objek lokasi yang tidak valid.
 * @param {import("@minecraft/server").Vector3} location
 * @returns {string} Kunci unik.
 */
export function getUniqueKeyFromLocation(location) {
    try {
        if (!location) {
            console.error(`[location_utils] Invalid (null/undefined) location passed to getUniqueKeyFromLocation.`);
            return `INVALID_LOCATION_NULL_${Math.random().toString(36).substring(7)}`;
        }
        
        // Coba akses properti x, y, z. Ini akan memicu InternalError jika objek 'location' tidak valid.
        const x = location.x;
        const y = location.y;
        const z = location.z;

        if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
            console.error(`[location_utils] Location properties are not numbers or invalid: ${JSON.stringify(location)}`);
            return `INVALID_LOCATION_NON_NUMERIC_${Math.random().toString(36).substring(7)}`;
        }
        return `${x},${y},${z}`;
    } catch (e) {
        // Tangkap InternalError atau error lain saat mengakses properti location
        console.error(`[location_utils] Error getting unique key for location (possibly invalid object): ${e.message} - ${JSON.stringify(location)}`);
        return `INVALID_LOCATION_ERROR_${Math.random().toString(36).substring(7)}`;
    }
}
