// BP/scripts/modules/puring_logic.js

import { world, system, BlockPermutation, GameMode, ItemStack } from "@minecraft/server";
import { getUniqueKeyFromLocation } from './location_utils.js'; 

const PURIFY_ITEM = "minecraft:nether_star";
const MAX_HEIGHT = 320;
const PURIFY_RADIUS = 16;
const STEP_DURATION_TICKS = 100; // 5 Detik

const activePurifications = new Set();

const DOWNGRADE_MAP = {
    "minecraft:soul_sand": "soulcraft:almost_full_soul_sand",
    "soulcraft:almost_full_soul_sand": "soulcraft:half_soul_sand",
    "soulcraft:half_soul_sand": "soulcraft:quarter_soul_sand",
    "soulcraft:quarter_soul_sand": "soulcraft:empty_soul_sand"
};

const RANDOM_EFFECTS = [
    { name: "regeneration", duration: 200, amp: 0 },
    { name: "speed", duration: 200, amp: 1 },
    { name: "resistance", duration: 200, amp: 0 },
    { name: "weakness", duration: 200, amp: 0 },
    { name: "levitation", duration: 20, amp: 0 },
    { name: "slow_falling", duration: 200, amp: 0 },
    { name: "nausea", duration: 100, amp: 0 }
];

function isSkyClear(block, dimension) {
    const startY = block.location.y + 1;

    for (let y = startY; y < MAX_HEIGHT; y++) {
        const checkLoc = { x: block.location.x, y: y, z: block.location.z };
        try {
            const checkBlock = dimension.getBlock(checkLoc);
            if (checkBlock && !checkBlock.isAir) {
                const isMossAtStart = (y === startY && checkBlock.typeId === "minecraft:moss_block");
                if (!isMossAtStart) {
                    return false;
                }
            }
        } catch (e) { break; }
    }
    return true;
}

function sculkifyBlock(loc, dimension) {
    const locAbove = { x: loc.x, y: loc.y + 1, z: loc.z };
    const blockAbove = dimension.getBlock(locAbove);

    if (!blockAbove) return;
    const isMoss = blockAbove.typeId === "minecraft:moss_block";

    if (isMoss) {
        blockAbove.setPermutation(BlockPermutation.resolve("minecraft:sculk"));
    }
    const effectLoc = { x: loc.x + 0.5, y: loc.y + 1.1, z: loc.z + 0.5 };
    dimension.playSound("block.sculk_catalyst.place", effectLoc);
    dimension.spawnParticle("minecraft:sculk_charge_particle", effectLoc);
}

// Helper untuk konsumsi item dari player
function consumeItemPlayer(player, slot, inventory) {
    if (player.getGameMode() === GameMode.Creative) return;

    const item = inventory.getItem(slot);
    if (item && item.typeId === PURIFY_ITEM) {
        if (item.amount > 1) {
            item.amount -= 1;
            inventory.setItem(slot, item);
        } else {
            inventory.setItem(slot, undefined); 
        }
    }
}

function applyAreaEffects(centerLoc, dimension) {
    const players = dimension.getPlayers({
        location: centerLoc,
        maxDistance: PURIFY_RADIUS
    });

    for (const p of players) {
        const effect = RANDOM_EFFECTS[Math.floor(Math.random() * RANDOM_EFFECTS.length)];
        try {
            p.addEffect(effect.name, effect.duration, { amplifier: effect.amp, showParticles: true });
        } catch (e) {}
    }
}

function spawnSoulParticles(centerLoc, dimension) {
    const rX = (Math.random() * 0.6) - 0.3;
    const rZ = (Math.random() * 0.6) - 0.3;
    
    const soulLoc = { 
        x: centerLoc.x + 0.5 + rX, 
        y: centerLoc.y + 1.2, 
        z: centerLoc.z + 0.5 + rZ
    };
    
    try {
        dimension.spawnParticle("minecraft:sculk_soul_particle", soulLoc);
        if (Math.random() > 0.5) {
            dimension.spawnParticle("minecraft:soul_particle", soulLoc);
        }
    } catch(e){}
}

function updateSurroundingLight(centerLoc, dimension, active, savedStates = {}) {
    const offsets = [
        { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }
    ];

    offsets.forEach(offset => {
        const targetLoc = { x: centerLoc.x + offset.x, y: centerLoc.y + offset.y, z: centerLoc.z + offset.z };
        const key = `${offset.x},${offset.y},${offset.z}`; 

        try {
            const block = dimension.getBlock(targetLoc);
            if (!block || !block.isValid) return;

            if (active) {
                const typeId = block.typeId;
                const isWater = typeId === "minecraft:water" || typeId === "minecraft:flowing_water";
                
                if (typeId === "minecraft:air" || isWater) {
                    savedStates[key] = isWater ? "minecraft:flowing_water" : "minecraft:air";
                    const lightPermutation = BlockPermutation.resolve("minecraft:light_block_14");
                    block.setPermutation(lightPermutation);
                    if (isWater) {
                        try { block.setWaterlogged(true); } catch(e){}
                    }
                }
            } else {
                if (block.typeId === "minecraft:light_block_14") {
                    const originalId = savedStates[key] || "minecraft:air";
                    block.setPermutation(BlockPermutation.resolve(originalId));
                }
            }
        } catch(e) {}
    });
    
    return savedStates;
}

function startPurificationLoop(block, dimension) {
    const loc = block.location;
    const blockKey = getUniqueKeyFromLocation(loc);
    
    activePurifications.add(blockKey);

    let ticksPassed = 0;
    
    dimension.playSound("beacon.activate", loc);
    
    let savedSurroundings = {};
    savedSurroundings = updateSurroundingLight(loc, dimension, true, savedSurroundings);

    const intervalId = system.runInterval(() => {
        let currentBlock;
        try {
            currentBlock = dimension.getBlock(loc);
        } catch(e) {
            updateSurroundingLight(loc, dimension, false, savedSurroundings);
            activePurifications.delete(blockKey);
            system.clearRun(intervalId); 
            return;
        }

        if (!currentBlock || (!DOWNGRADE_MAP.hasOwnProperty(currentBlock.typeId) && currentBlock.typeId !== "soulcraft:empty_soul_sand")) {
            updateSurroundingLight(loc, dimension, false, savedSurroundings);
            activePurifications.delete(blockKey);
            system.clearRun(intervalId);
            return;
        }

        if (ticksPassed % 10 === 0) {
            spawnSoulParticles(loc, dimension);
        }
        
        if (ticksPassed % 20 === 0) {
            applyAreaEffects(loc, dimension);
            if (ticksPassed % 40 === 0) {
                dimension.playSound("beacon.ambient", loc);
            }
        }

        if (ticksPassed >= STEP_DURATION_TICKS) {
            ticksPassed = 0; 

            const nextTypeId = DOWNGRADE_MAP[currentBlock.typeId];
            
            if (nextTypeId) {
                currentBlock.setPermutation(BlockPermutation.resolve(nextTypeId));
                dimension.playSound("block.grindstone.use", loc); 
                dimension.spawnParticle("minecraft:sculk_charge_particle", {x: loc.x+0.5, y: loc.y+1.1, z: loc.z+0.5});

                if (nextTypeId === "soulcraft:empty_soul_sand") {
                    dimension.playSound("beacon.deactivate", loc);
                    updateSurroundingLight(loc, dimension, false, savedSurroundings);
                    
                    for(let i=0; i<5; i++) {
                        system.runTimeout(() => {
                            try {
                                dimension.spawnParticle("minecraft:sculk_soul_particle", {
                                    x: loc.x + 0.5 + (Math.random() - 0.5), 
                                    y: loc.y + 1.5 + (Math.random() * 0.5), 
                                    z: loc.z + 0.5 + (Math.random() - 0.5)
                                });
                            } catch(e){}
                        }, i * 2);
                    }
                    
                    dimension.spawnParticle("minecraft:wax_off_particle", {x: loc.x+0.5, y: loc.y+1, z: loc.z+0.5});
                    
                    sculkifyBlock(loc, dimension);
                    activePurifications.delete(blockKey);
                    system.clearRun(intervalId);
                }
            } else {
                updateSurroundingLight(loc, dimension, false, savedSurroundings);
                activePurifications.delete(blockKey);
                system.clearRun(intervalId);
            }
        }

        ticksPassed++;
    }, 1); 
}

// --- HANDLER INTERAKSI PEMAIN (KLIK KANAN) ---
export function handlePurificationInteraction(event) {
    const { player, block, itemStack } = event;
    
    if (!itemStack || itemStack.typeId !== PURIFY_ITEM) return;
    if (!DOWNGRADE_MAP.hasOwnProperty(block.typeId)) return;

    const blockKey = getUniqueKeyFromLocation(block.location);
    if (activePurifications.has(blockKey)) return;

    const dimension = player.dimension;
    if (!isSkyClear(block, dimension)) {
        player.sendMessage("§c[SoulCraft] Purification failed: Sky is obstructed!");
        dimension.playSound("note.bass", block.location);
        return;
    }

    const inventory = player.getComponent("minecraft:inventory")?.container;
    if (inventory) {
        consumeItemPlayer(player, player.selectedSlotIndex, inventory);
    }

    player.sendMessage("§b[SoulCraft] Purification started...");
    startPurificationLoop(block, dimension);
}

// Helper untuk mendapatkan vektor arah dari state facing_direction
function getDispenserFacingVector(facing) {
    // Bedrock state 'facing_direction' biasanya angka atau string int
    // 0: down, 1: up, 2: north, 3: south, 4: west, 5: east
    switch (facing) {
        case 0: return { x: 0, y: -1, z: 0 }; // Down
        case 1: return { x: 0, y: 1, z: 0 };  // Up
        case 2: return { x: 0, y: 0, z: -1 }; // North
        case 3: return { x: 0, y: 0, z: 1 };  // South
        case 4: return { x: -1, y: 0, z: 0 }; // West
        case 5: return { x: 1, y: 0, z: 0 };  // East
        default: return { x: 0, y: 0, z: 0 };
    }
}

// --- HANDLER DISPENSER (ENTITY ITEM SPAWN) ---
world.afterEvents.entitySpawn.subscribe((event) => {
    const { entity } = event;
    
    if (entity.typeId !== "minecraft:item") return;

    const itemComp = entity.getComponent("minecraft:item");
    if (!itemComp || !itemComp.itemStack || itemComp.itemStack.typeId !== PURIFY_ITEM) return;

    const dimension = entity.dimension;
    const itemLoc = entity.location;

    // LOGIKA BARU: Cari Dispenser di sekitar item
    const searchRadius = 2; // Radius aman
    let dispenserBlock = null;
    let targetBlock = null;

    // Scan area sekitar item untuk mencari Dispenser
    for (let x = -searchRadius; x <= searchRadius; x++) {
        for (let y = -searchRadius; y <= searchRadius; y++) {
            for (let z = -searchRadius; z <= searchRadius; z++) {
                const checkLoc = { 
                    x: Math.floor(itemLoc.x + x), 
                    y: Math.floor(itemLoc.y + y), 
                    z: Math.floor(itemLoc.z + z) 
                };
                
                try {
                    const block = dimension.getBlock(checkLoc);
                    if (block && block.typeId === "minecraft:dispenser") {
                        // Ketemu Dispenser! Sekarang cek arahnya.
                        const facingState = block.permutation.getState("facing_direction");
                        const dirVector = getDispenserFacingVector(facingState);
                        
                        // Cek Blok DI DEPAN Dispenser (Target Tembakan)
                        const targetLoc = {
                            x: block.location.x + dirVector.x,
                            y: block.location.y + dirVector.y,
                            z: block.location.z + dirVector.z
                        };
                        
                        // Dispenser yang menghadap ATAS (facing=1) tidak boleh memicu
                        // Karena targetnya ada di atas (menghalangi sky / jalur jiwa)
                        if (facingState === 1) continue; 

                        const possibleTarget = dimension.getBlock(targetLoc);
                        
                        // Apakah targetnya adalah Soul Sand yang valid?
                        if (possibleTarget && DOWNGRADE_MAP.hasOwnProperty(possibleTarget.typeId)) {
                            dispenserBlock = block;
                            targetBlock = possibleTarget;
                            break; // Ketemu pasangan valid!
                        }
                    }
                } catch(e) {}
            }
            if (dispenserBlock) break;
        }
        if (dispenserBlock) break;
    }

    // Jika Validasi Sukses (Dispenser menembak ke Soul Sand)
    if (targetBlock) {
        // Cek Status Aktif
        const blockKey = getUniqueKeyFromLocation(targetBlock.location);
        if (activePurifications.has(blockKey)) return;

        // Cek Sky
        if (!isSkyClear(targetBlock, dimension)) {
            return;
        }

        // --- SUKSES! ---
        system.run(() => {
            try {
                if (entity.isValid) entity.remove(); // Hapus item
                
                // Mulai Purifikasi
                startPurificationLoop(targetBlock, dimension);
                
                dimension.spawnParticle("minecraft:end_rod", itemLoc);
            } catch(e) {}
        });
    }
});