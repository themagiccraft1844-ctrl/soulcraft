// BP/scripts/modules/blocked_candidate_block.js

import { world, BlockPermutation } from '@minecraft/server';

/**
 * Daftar blok yang dianggap "transparan" terhadap suhu dingin.
 * Suhu dingin bisa menembus blok-blok ini.
 */
const COLD_PERMEABLE_BLOCKS = [
    "minecraft:air",
    "minecraft:water",
    "minecraft:flowing_water",
    "minecraft:ice",
    "minecraft:packed_ice",
    "minecraft:blue_ice",
    "minecraft:frosted_ice",
    "minecraft:snow",
    "minecraft:snow_layer",
    "soulcraft:empty_soul_sand", // Diri sendiri
    "soulcraft:quarter_soul_sand",
    "soulcraft:half_soul_sand",
    "soulcraft:almost_full_soul_sand"
];

/**
 * Mengecek apakah sebuah blok adalah penghalang solid bagi suhu dingin.
 * Blok Es Family TIDAK dianggap penghalang (suhu tembus).
 */
function isSolidObstacle(block) {
    if (!block || !block.isValid) return false;
    
    const typeId = block.typeId;
    
    // Jika termasuk dalam daftar yang bisa ditembus, bukan obstacle
    if (COLD_PERMEABLE_BLOCKS.includes(typeId)) return false;

    // Cara sederhana menentukan soliditas tanpa properti isSolid (API terbatas):
    // Kita anggap semua blok selain list di atas adalah penghalang potensial.
    // TAPI, kita harus hati-hati dengan bunga/rumput.
    // Untuk keamanan logika "pembekuan", kita anggap blok apa pun yang tidak di whitelist
    // adalah penghalang.
    return true; 
}

/**
 * Mengecek apakah target dikelilingi oleh blok solid (terisolasi).
 * Syarat: 5 dari 6 sisi kardinal tertutup blok solid non-ice.
 */
function isEnclosedBySolids(targetBlock, dimension) {
    const { x, y, z } = targetBlock.location;
    
    // 6 Arah Kardinal
    const neighbors = [
        { x: x + 1, y: y, z: z },
        { x: x - 1, y: y, z: z },
        { x: x, y: y + 1, z: z },
        { x: x, y: y - 1, z: z },
        { x: x, y: y, z: z + 1 },
        { x: x, y: y, z: z - 1 }
    ];

    let solidCount = 0;

    for (const loc of neighbors) {
        try {
            const block = dimension.getBlock(loc);
            if (isSolidObstacle(block)) {
                solidCount++;
            }
        } catch (e) {
            // Jika chunk belum load, anggap solid demi keamanan
            solidCount++;
        }
    }

    // Jika 5 sisi tertutup, suhu dingin tidak bisa masuk efektif
    return solidCount >= 5;
}

/**
 * Mengecek jalur dari Anchor (ESS) ke Target (Water).
 * Menggunakan algoritma langkah sederhana (Line of Sight).
 */
function isPathObstructed(targetLoc, anchorLoc, dimension) {
    // Vektor arah
    const dx = targetLoc.x - anchorLoc.x;
    const dy = targetLoc.y - anchorLoc.y;
    const dz = targetLoc.z - anchorLoc.z;
    
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const steps = Math.floor(distance);

    // Jika bersebelahan (jarak < 1.5), tidak ada penghalang di tengah
    if (steps < 2) return false;

    // Normalisasi langkah
    const stepX = dx / distance;
    const stepY = dy / distance;
    const stepZ = dz / distance;

    // Mulai loop dari i=1 (langkah pertama setelah Anchor)
    // Berhenti di i < steps (sebelum menyentuh Target)
    // Agar Anchor dan Target sendiri tidak dianggap penghalang
    for (let i = 1; i < steps; i++) {
        const checkLoc = {
            x: Math.floor(anchorLoc.x + (stepX * i) + 0.5), // +0.5 untuk rounding ke tengah block
            y: Math.floor(anchorLoc.y + (stepY * i) + 0.5),
            z: Math.floor(anchorLoc.z + (stepZ * i) + 0.5)
        };

        try {
            const block = dimension.getBlock(checkLoc);
            // Jika ketemu SATU saja penghalang solid di jalur lurus
            if (isSolidObstacle(block)) {
                return true; // Terhalang!
            }
        } catch (e) {
            return true; // Safety
        }
    }

    return false;
}

/**
 * FUNGSI UTAMA: Menentukan apakah kandidat ini VALID atau TERBLOKIR.
 * @returns {boolean} True jika TERBLOKIR (jangan dibekukan). False jika AMAN.
 */
export function isCandidateBlocked(targetBlock, anchorLocation, dimension) {
    if (!targetBlock || !targetBlock.isValid) return true;

    // 1. Cek Isolasi (Enclosure Rule)
    // "5 sisi kardinal block candidate tertutup block solid non-ice"
    if (isEnclosedBySolids(targetBlock, dimension)) {
        return true; 
    }

    // 2. Cek Jalur Pandang (Line of Sight Rule)
    // "ada penghalang block solid di arah datangnya suhu dingin"
    if (isPathObstructed(targetBlock.location, anchorLocation, dimension)) {
        return true;
    }

    return false; // Lolos seleksi, boleh dibekukan
}