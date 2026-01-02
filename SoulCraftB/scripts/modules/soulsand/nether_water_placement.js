// BP/scripts/modules/nether_water_placement.js

import { world, system, BlockPermutation, LiquidType, ItemStack, Direction, GameMode } from "@minecraft/server";
import { getUniqueKeyFromLocation, isBlockAnchored, distanceSquared } from './location_utils.js';
import { isCandidateBlocked } from './blocked_candidate_block.js';

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

// Helper untuk memprediksi lokasi target air
function getWaterTargetLocation(event) {
    const { block, blockFace } = event;
    if (LIQUID_BREAKABLE_BLOCKS.has(block.typeId)) {
        return block.location;
    } else if (block.canContainLiquid(LiquidType.Water) && !block.isWaterlogged && block.typeId !== "minecraft:air") {
        return block.location;
    } else {
        return block.offset(getVectorFromDirection(blockFace));
    }
}

/**
 * Fungsi utama yang menangani logika penempatan air di Nether.
 */
export function handleNetherWaterPlacement(event, activeMakers, SOUL_SAND_BLOCK_TYPES, SoulSandData, soulSandTickHandlers) {
    const { player, block, itemStack } = event;
    const dimension = player.dimension;
    const radius = 5;

    // Safety check
    if (itemStack?.typeId !== 'minecraft:water_bucket') return;

    let anchorFound = false;

    // Lokasi target air untuk validasi blockage
    const targetLoc = getWaterTargetLocation(event);
    const targetBlock = dimension.getBlock(targetLoc);
    
    if (!targetBlock || !targetBlock.isValid) return;

    // --- STEP 1: Cek Anchor yang Sudah Aktif ---
    let nearestActiveAnchor = null;
    let minDistance = Infinity;

    for (const [key, maker] of activeMakers) {
        if (maker.dimension.id !== dimension.id) continue;
        const d = distanceSquared(targetLoc, maker.location);
        if (d <= radius * radius) {
            if (d < minDistance) {
                minDistance = d;
                nearestActiveAnchor = maker;
            }
        }
    }

    if (nearestActiveAnchor) {
        // [FITUR BARU] Validasi Penghalang (Blocked Candidate)
        if (!isCandidateBlocked(targetBlock, nearestActiveAnchor.location, dimension)) {
             placeWater(event);
             return;
        } else {
            // TERBLOKIR: Tampilkan partikel marah, jangan place water (biarkan menguap vanilla)
            system.run(() => {
                try { dimension.spawnParticle("minecraft:villager_angry", targetLoc); } catch(e){}
            });
            return; 
        }
    }

    // --- STEP 2: Scan Manual (Lazy Load / Registrasi Baru) ---
    for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
            for (let z = -radius; z <= radius; z++) {
                const checkLoc = { x: block.location.x + x, y: block.location.y + y, z: block.location.z + z };
                try {
                    const nearbyBlock = player.dimension.getBlock(checkLoc);
                    if (nearbyBlock && SOUL_SAND_BLOCK_TYPES.includes(nearbyBlock.typeId)) {
                        
                        // Validasi Blockage SEBELUM registrasi
                        if (!isCandidateBlocked(targetBlock, nearbyBlock.location, dimension)) {
                            
                            const nearbyBlockKey = getUniqueKeyFromLocation(nearbyBlock.location);
                            if (!activeMakers.has(nearbyBlockKey)) {
                                let deathCount = SOUL_SAND_BLOCK_TYPES.indexOf(nearbyBlock.typeId);
                                const tickHandler = system.runInterval(() => {
                                    if (activeMakers.has(nearbyBlockKey)) activeMakers.get(nearbyBlockKey).handleBehavior();
                                }, 5);
                                
                                const soulSandData = new SoulSandData(nearbyBlock.location, player.dimension, deathCount);
                                soulSandData.tickHandler = tickHandler; 
                                
                                activeMakers.set(nearbyBlockKey, soulSandData);
                                soulSandTickHandlers.set(nearbyBlockKey, tickHandler);
                            }
                            anchorFound = true;
                            placeWater(event);
                            return; 
                        }
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
 */
function placeWater(event) {
    event.cancel = true; // KUNCI: Batalkan event vanilla agar air tidak menguap
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
                const particleLoc = finalTargetLoc.offset({ x: 1, y: 1, z: 1 });
                try { player.dimension.spawnParticle("minecraft:bubble_column_down_particle", particleLoc); } catch(e) {}

                // --- LOGIKA PENGURANGAN ITEM ---
                const gameMode = player.getGameMode();
                const inventory = player.getComponent("minecraft:inventory")?.container;
                
                if (inventory) {
                    const slot = player.selectedSlotIndex;
                    const item = inventory.getItem(slot);

                    // SURVIVAL / ADVENTURE CHECK
                    // Menggunakan GameMode.Creative untuk keamanan
                    if (gameMode !== GameMode.Creative) { 
                        if (item && item.typeId === "minecraft:water_bucket") {
                             if (item.amount > 1) {
                                 item.amount -= 1;
                                 inventory.setItem(slot, item);
                                 try { inventory.addItem(new ItemStack("minecraft:bucket", 1)); } 
                                 catch (err) { player.dimension.spawnItem(new ItemStack("minecraft:bucket", 1), player.location); }
                             } else {
                                 // Ganti stack 1 water bucket dengan bucket kosong
                                 inventory.setItem(slot, new ItemStack("minecraft:bucket", 1));
                             }
                        }
                    } 
                }
            }
        } catch (e) {
            console.error(`[ERROR] Error menempatkan air di Nether: ${e.message}`);
        }
    });
}