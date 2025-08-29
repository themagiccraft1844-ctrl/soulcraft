// BP/scripts/modules/nether_water_placement.js

import { world, system, BlockPermutation, LiquidType, ItemStack, Direction, MolangVariableMap } from "@minecraft/server";
import { getUniqueKeyFromLocation, isBlockAnchored } from './location_utils';
// --- Variabel & Fungsi Bantuan ---
const LIQUID_BREAKABLE_BLOCKS = new Set([
    "minecraft:torch", "minecraft:redstone_torch", "minecraft:soul_torch", "minecraft:brown_mushroom",
    "minecraft:red_mushroom", "minecraft:nether_sprouts", "minecraft:warped_fungus", "minecraft:crimson_fungus",
    "minecraft:crimson_roots", "minecraft:redstone_wire", "minecraft:ladder", "minecraft:vine",
    "minecraft:tripwire_hook", "minecraft:string", "minecraft:lever", "minecraft:button", "minecraft:sugar_cane",
    "minecraft:wheat", "minecraft:carrots", "minecraft:potatoes", "minecraft:beetroots", "minecraft:tallgrass",
    "minecraft:fern", "minecraft:deadbush", "minecraft:lily_pad", "minecraft:twisting_vines", "minecraft:weeping_vines"
]);

function getItemIdFromBlockId(blockId) {
    const map = {
        "minecraft:string": "minecraft:string", "minecraft:wheat": "minecraft:wheat_seeds",
        "minecraft:carrots": "minecraft:carrot", "minecraft:potatoes": "minecraft:potato",
        "minecraft:beetroots": "minecraft:beetroot_seeds", "minecraft:tallgrass": "minecraft:wheat_seeds",
        "minecraft:fern": "minecraft:wheat_seeds", "minecraft:deadbush": "minecraft:stick",
        "minecraft:brown_mushroom": "minecraft:brown_mushroom", "minecraft:red_mushroom": "minecraft:red_mushroom",
        "minecraft:nether_sprouts": "minecraft:nether_sprouts", "minecraft:warped_fungus": "minecraft:warped_fungus",
        "minecraft:crimson_fungus": "minecraft:crimson_fungus", "minecraft:crimson_roots": "minecraft:crimson_roots",
        "minecraft:lily_pad": "minecraft:lily_pad", "minecraft:twisting_vines": "minecraft:twisting_vines", "minecraft:weeping_vines": "minecraft:weeping_vines"
    };
    return map[blockId] || blockId;
}

function getVectorFromDirection(direction) {
    switch (direction) {
        case Direction.Down: return { x: 0, y: -1, z: 0 };
        case Direction.Up: return { x: 0, y: 1, z: 0 };
        case Direction.North: return { x: 0, y: 0, z: -1 };
        case Direction.South: return { x: 0, y: 0, z: 1 };
        case Direction.West: return { x: -1, y: 0, z: 0 };
        case Direction.East: return { x: 1, y: 0, z: 0 };
        default: return { x: 0, y: 0, z: 0 };
    }
}

/**
 * Fungsi utama yang menangani logika penempatan air di Nether.
 * @param {import("@minecraft/server").PlayerInteractWithBlockBeforeEvent} event - Event dari interaksi pemain.
 * @param {Map<string, any>} activeMakers - Referensi ke peta anchor yang aktif.
 * @param {string[]} SOUL_SAND_BLOCK_TYPES - Array tipe blok anchor.
 * @param {any} SoulSandData - Referensi ke kelas SoulSandData untuk membuat instance baru.
 * @param {Map<string, number>} soulSandTickHandlers - Referensi ke peta tick handler.
 */
export function handleNetherWaterPlacement(event, activeMakers, SOUL_SAND_BLOCK_TYPES, SoulSandData, soulSandTickHandlers) {
    const { player, block } = event;
    const radius = 5;
    let anchorFound = false;

    // 1. Cek dulu dengan isBlockAnchored yang lebih efisien
    if (isBlockAnchored(block.location, player.dimension, activeMakers, null, radius)) {
        placeWater(event);
        return;
    }

    // 2. Jika tidak ada anchor aktif, lakukan pemindaian manual
    for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
            for (let z = -radius; z <= radius; z++) {
                const checkLoc = { x: block.location.x + x, y: block.location.y + y, z: block.location.z + z };
                try {
                    const nearbyBlock = player.dimension.getBlock(checkLoc);
                    if (nearbyBlock && SOUL_SAND_BLOCK_TYPES.includes(nearbyBlock.typeId)) {
                        const nearbyBlockKey = getUniqueKeyFromLocation(nearbyBlock.location);
                        if (!activeMakers.has(nearbyBlockKey)) {
                            // 3. Daftarkan blok yang tidak aktif
                            let deathCount = SOUL_SAND_BLOCK_TYPES.indexOf(nearbyBlock.typeId);
                            const tickHandler = system.runInterval(() => {
                                if (activeMakers.has(nearbyBlockKey)) activeMakers.get(nearbyBlockKey).handleBehavior();
                            }, 5);
                            const soulSandData = new SoulSandData(nearbyBlock.location, player.dimension, tickHandler, null, deathCount);
                            activeMakers.set(nearbyBlockKey, soulSandData);
                            soulSandTickHandlers.set(nearbyBlockKey, tickHandler);
                        }
                        anchorFound = true;
                        placeWater(event);
                        break;
                    }
                } catch (e) { /* Abaikan */ }
            }
            if (anchorFound) break;
        }
        if (anchorFound) break;
    }
}

/**
 * Fungsi internal untuk menjalankan aksi penempatan air.
 * @param {import("@minecraft/server").PlayerInteractWithBlockBeforeEvent} event 
 */
function placeWater(event) {
    event.cancel = true;
    const { player, block, blockFace } = event;
    let finalTargetLoc;

    if (LIQUID_BREAKABLE_BLOCKS.has(block.typeId)) {
        finalTargetLoc = block.location;
    } else if (block.canContainLiquid(LiquidType.Water) && !block.isWaterlogged && block.typeId !== "minecraft:air") {
        finalTargetLoc = block.location;
    } else {
        finalTargetLoc = block.offset(getVectorFromDirection(blockFace));
    }

    system.run(() => {
        try {
            const blockToModify = player.dimension.getBlock(finalTargetLoc);
            if (!blockToModify || !blockToModify.isValid) return;

            let waterPlaced = false;
            const blockTypeId = blockToModify.typeId;

            if (blockTypeId === "minecraft:fire" || blockTypeId === "minecraft:soul_fire" || LIQUID_BREAKABLE_BLOCKS.has(blockTypeId) || blockTypeId === "minecraft:air" || blockTypeId === "minecraft:water" || blockTypeId === "minecraft:flowing_water") {
                if (LIQUID_BREAKABLE_BLOCKS.has(blockTypeId)) {
                    try { player.dimension.spawnItem(new ItemStack(getItemIdFromBlockId(blockTypeId), 1), blockToModify.location); } catch (e) {}
                }
                blockToModify.setPermutation(BlockPermutation.resolve("minecraft:flowing_water"));
                waterPlaced = true;
            } else if (blockToModify.canContainLiquid(LiquidType.Water) && !blockToModify.isWaterlogged) {
                blockToModify.setWaterlogged(true);
                waterPlaced = true;
            } else if (blockTypeId === "minecraft:lava" || blockTypeId === "minecraft:flowing_lava") {
                blockToModify.setPermutation(BlockPermutation.resolve("minecraft:obsidian"));
            }
            
            if (waterPlaced) {
                player.dimension.playSound("bucket.empty_water", finalTargetLoc);
                const particleLoc = finalTargetLoc.offset({ x: 0, y: 1, z: 0 });
                player.dimension.spawnParticle("minecraft:bubble_column_down_particle", particleLoc);
            }
        } catch (e) {
            console.error(`[ERROR] Error menempatkan air di Nether: ${e.message}`);
        }
    });
}
