// BP/scripts/modules/keeps_water_utils.js

import { world, system, BlockPermutation } from "@minecraft/server";
import { getUniqueKeyFromLocation, isBlockAnchored } from './location_utils';

/**
 * Membersihkan air dan blok waterlogged di sekitar lokasi anchor yang dihancurkan, khusus untuk dimensi Nether.
 * @param {import("@minecraft/server").Vector3} anchorLocation - Lokasi blok anchor yang dihancurkan.
 * @param {import("@minecraft/server").Dimension} dimension - Dimensi tempat blok berada.
 * @param {Map<string, any>} activeMakers - Map global yang menyimpan data anchor aktif.
 */
export function cleanupWaterOnAnchorBreak(anchorLocation, dimension, activeMakers) {
    console.log(`[DEBUG keeps_water_utils] cleanupWaterOnAnchorBreak dipanggil untuk anchor di ${getUniqueKeyFromLocation(anchorLocation)}. Dimensi: ${dimension.id}.`);
    
    // PERUBAHAN: Pindahkan semua logika ke dalam blok kondisi Nether
    if (dimension.id === "minecraft:nether") {
        // Mainkan suara mendesis satu kali di lokasi anchor yang hancur
        dimension.playSound("random.fizz", anchorLocation);

        const cleanupRadius = 8; // Radius pembersihan dari pusat anchor
        const anchorCheckRadius = 5; // Radius untuk memeriksa anchor lain yang melindungi

        for (let x = -cleanupRadius; x <= cleanupRadius; x++) {
            for (let y = -cleanupRadius; y <= cleanupRadius; y++) {
                for (let z = -cleanupRadius; z <= cleanupRadius; z++) {
                    const targetLoc = {
                        x: anchorLocation.x + x,
                        y: anchorLocation.y + y,
                        z: anchorLocation.z + z
                    };

                    try {
                        const targetBlock = dimension.getBlock(targetLoc);
                        if (!targetBlock || !targetBlock.isValid) continue;

                        const isProtected = isBlockAnchored(targetLoc, dimension, activeMakers, anchorLocation, anchorCheckRadius);
                        if (isProtected) {
                            continue;
                        }
                        
                        if (targetBlock.isWaterlogged) {
                            console.log(`[DEBUG keeps_water_utils] Menemukan blok waterlogged di Nether di ${getUniqueKeyFromLocation(targetLoc)}.`);
                            system.run(() => {
                                if (targetBlock.isValid) {
                                    targetBlock.setWaterlogged(false);
                                    console.log(`[DEBUG keeps_water_utils] Status waterlogged dihapus dari blok di ${getUniqueKeyFromLocation(targetLoc)}.`);
                                    dimension.spawnParticle("minecraft:water_evaporation_bucket_emitter", targetLoc);
                                }
                            });
                        }

                        if (targetBlock.typeId === "minecraft:water" || targetBlock.typeId === "minecraft:flowing_water") {
                            console.log(`[DEBUG keeps_water_utils] Menemukan blok air di Nether di ${getUniqueKeyFromLocation(targetLoc)}.`);
                            system.run(() => {
                                if (targetBlock.isValid) {
                                    targetBlock.setPermutation(BlockPermutation.resolve("minecraft:air"));
                                    console.log(`[DEBUG keeps_water_utils] Blok air di ${getUniqueKeyFromLocation(targetLoc)} diuapkan.`);
                                    dimension.spawnParticle("minecraft:water_evaporation_bucket_emitter", targetLoc);
                                }
                            });
                        }

                    } catch (e) {
                        console.warn(`[DEBUG keeps_water_utils] Error saat memeriksa/membersihkan blok di ${getUniqueKeyFromLocation(targetLoc)}: ${e.message}`);
                    }
                }
            }
        }
    }
    console.log(`[DEBUG keeps_water_utils] cleanupWaterOnAnchorBreak selesai untuk anchor di ${getUniqueKeyFromLocation(anchorLocation)}.`);
}
