import { world, system, BlockPermutation, ItemStack } from "@minecraft/server";
// Import fungsi logika portal dari file sebelah
import { checkAndFillPortal, extinguishPortal } from "./portal_utils.js"; 

const DIRECTION_MAP = { 0: "south", 1: "west", 2: "north", 3: "east" };
const REVERSE_DIRECTION_MAP = { "south": 0, "west": 1, "north": 2, "east": 3 };
const revertTimers = new Map();

function getBlockKey(block) {
    const loc = block.location;
    return `${loc.x},${loc.y},${loc.z},${block.dimension.id}`;
}

/**
 * 1. ENTITY HIT BLOCK (After Event)
 * Mekanisme Pukul & Support Mixed Frame
 */
world.afterEvents.entityHitBlock.subscribe((event) => {
    const { hitBlock } = event;
    
    if (hitBlock.typeId === "minecraft:end_portal_frame") {
        const originalPermutation = hitBlock.permutation;
        const vanillaDirection = originalPermutation.getState("direction") ?? 0;
        const vanillaEyeBit = originalPermutation.getState("end_portal_eye_bit") ?? false;
        
        const customDirection = DIRECTION_MAP[vanillaDirection];

        const customPermutation = BlockPermutation.resolve("soulcraft:end_portal_frame", {
            "soulcraft:cardinal_direction": customDirection,
            "soulcraft:eye_bit": vanillaEyeBit
        });

        // Swap ke Custom Block
        hitBlock.setPermutation(customPermutation);

        const blockKey = getBlockKey(hitBlock);

        // --- LOGIKA MIXED FRAME & PORTAL MAINTENANCE ---
        if (vanillaEyeBit) {
            system.run(() => {
                const currentBlock = hitBlock.dimension.getBlock(hitBlock.location);
                if (currentBlock && currentBlock.typeId === "soulcraft:end_portal_frame") {
                    // Cek struktur. Jika valid (mixed frame), paksa block portal (tengah) untuk tetap ada.
                    // Frame ini dibiarkan tetap CUSTOM agar player bisa menghancurkannya jika mau (hit ke-2).
                    checkAndFillPortal(currentBlock); 
                }
            });
        }
        // ---------------------------------------------------

        // Timer Revert Normal
        if (revertTimers.has(blockKey)) system.clearRun(revertTimers.get(blockKey));

        const runId = system.runTimeout(() => {
            try {
                const checkBlock = hitBlock.dimension.getBlock(hitBlock.location);
                // Jika masih ada (belum dihancurkan player), kembalikan ke Vanilla (Solid/Unbreakable)
                if (checkBlock && checkBlock.typeId === "soulcraft:end_portal_frame") {
                    const restorePermutation = BlockPermutation.resolve("minecraft:end_portal_frame", {
                        "direction": vanillaDirection,
                        "end_portal_eye_bit": vanillaEyeBit
                    });
                    checkBlock.setPermutation(restorePermutation);
                }
            } catch (e) { console.warn("Restore error: " + e); }
            revertTimers.delete(blockKey);
        }, 200);

        revertTimers.set(blockKey, runId);
    }
});

/**
 * 2. ITEM USE (Before Event) - Logic Aktivasi Portal
 * Menangani Vanilla Frame DAN Custom Frame
 */
world.beforeEvents.itemUse.subscribe((event) => {
    const { itemStack, source } = event;
    const player = source;

    if (!itemStack) return;
    if (itemStack.typeId !== "minecraft:ender_eye") return;

    const blockHit = player.getBlockFromViewDirection({ maxDistance: 6 });
    if (!blockHit) return;

    const block = blockHit.block;
    
    // Siapkan data untuk system.run
    const dimension = player.dimension;
    const location = block.location;
    const soundLoc = { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 };

    // KASUS A: CUSTOM FRAME
    if (block.typeId === "soulcraft:end_portal_frame") {
        const currentPermutation = block.permutation;
        const isEyeFilled = currentPermutation.getState("soulcraft:eye_bit");

        if (!isEyeFilled) {
            event.cancel = true; // Batalkan animasi lempar mata

            const currentCustomDirection = currentPermutation.getState("soulcraft:cardinal_direction");
            const selectedSlot = player.selectedSlotIndex;

            system.run(() => {
                const targetBlock = dimension.getBlock(location);
                if (!targetBlock) return;

                const vanillaDirectionInt = REVERSE_DIRECTION_MAP[currentCustomDirection] ?? 0;
                
                // Ubah jadi Vanilla + Eye
                const filledVanillaPermutation = BlockPermutation.resolve("minecraft:end_portal_frame", {
                    "direction": vanillaDirectionInt,
                    "end_portal_eye_bit": true
                });

                targetBlock.setPermutation(filledVanillaPermutation);
                dimension.playSound("block.end_portal_frame.fill", soundLoc);

                // CEK AKTIVASI PORTAL (Custom Size)
                const isActivated = checkAndFillPortal(targetBlock);
                if (isActivated) {
                     dimension.playSound("block.end_portal.spawn", soundLoc);
                }

                // Inventory Management (Survival)
                if (player.getGameMode() !== "creative") {
                    const inventory = player.getComponent("minecraft:inventory");
                    if (inventory && inventory.container) {
                        const currentItem = inventory.container.getItem(selectedSlot);
                        if (currentItem && currentItem.typeId === "minecraft:ender_eye") {
                            if (currentItem.amount > 1) {
                                currentItem.amount -= 1;
                                inventory.container.setItem(selectedSlot, currentItem);
                            } else {
                                inventory.container.setItem(selectedSlot, undefined);
                            }
                        }
                    }
                }
            });
        }
    } 
    // KASUS B: VANILLA FRAME (Agar support custom size 2x2, 4x4, dll pada block vanilla)
    else if (block.typeId === "minecraft:end_portal_frame") {
        const isEyeFilled = block.permutation.getState("end_portal_eye_bit");
        
        // Jika mata belum terisi, kita biarkan vanilla menangani pengisian mata (jangan di-cancel),
        // TAPI kita pasang listener di tick berikutnya untuk mengecek portal custom size.
        if (!isEyeFilled) {
            system.run(() => {
                const targetBlock = dimension.getBlock(location);
                // Cek lagi apakah sekarang matanya sudah terisi (oleh vanilla logic)
                if (targetBlock && targetBlock.permutation.getState("end_portal_eye_bit")) {
                    // Cek Portal Custom Size
                    const isActivated = checkAndFillPortal(targetBlock);
                    if (isActivated) {
                        dimension.playSound("block.end_portal.spawn", soundLoc);
                    }
                }
            });
        }
    }
});

/**
 * 3. PLAYER BREAK BLOCK (Before Event)
 */
world.beforeEvents.playerBreakBlock.subscribe((event) => {
    const { block, dimension, player } = event;

    if (block.typeId === "soulcraft:end_portal_frame") {
        if (player && player.getGameMode() === "creative") return;

        event.cancel = true;

        const location = block.location;
        const center = { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 };
        const currentPermutation = block.permutation;
        const hasEye = currentPermutation.getState("soulcraft:eye_bit");

        system.run(() => {
            // Matikan portal di sekitarnya
            extinguishPortal(location, dimension);

            const targetBlock = dimension.getBlock(location);
            if (targetBlock) {
                targetBlock.setPermutation(BlockPermutation.resolve("minecraft:air"));
                dimension.playSound("dig.stone", center);
            }

            dimension.spawnItem(new ItemStack("minecraft:end_portal_frame", 1), center);
            
            if (hasEye) {
                dimension.spawnItem(new ItemStack("minecraft:ender_eye", 1), center);
            }
        });
    }
});