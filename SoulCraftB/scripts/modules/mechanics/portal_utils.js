import { BlockPermutation } from "@minecraft/server";

const FACING_OFFSETS = {
    0: { x: 0, y: 0, z: 1 },  // South
    1: { x: -1, y: 0, z: 0 }, // West
    2: { x: 0, y: 0, z: -1 }, // North
    3: { x: 1, y: 0, z: 0 }   // East
};

const MAX_PORTAL_SIZE = 64; 

// Mapping balik untuk helper direction
const REVERSE_DIRECTION_MAP = {
    "south": 0, "west": 1, "north": 2, "east": 3
};

function getFrameDirection(block) {
    if (!block) return 0;
    if (block.typeId === "minecraft:end_portal_frame") {
        return block.permutation.getState("direction") ?? 0;
    } 
    if (block.typeId === "soulcraft:end_portal_frame") {
        const dirStr = block.permutation.getState("soulcraft:cardinal_direction");
        return REVERSE_DIRECTION_MAP[dirStr] ?? 0;
    }
    return 0;
}

/**
 * Validasi Frame: Mendukung Mixed Frame (Vanilla & Custom)
 * Asalkan memiliki mata, dianggap valid sebagai dinding portal.
 */
function isValidFrameWithEye(block) {
    if (!block) return false;
    if (block.typeId === "minecraft:end_portal_frame") {
        return block.permutation.getState("end_portal_eye_bit") === true;
    }
    if (block.typeId === "soulcraft:end_portal_frame") {
        return block.permutation.getState("soulcraft:eye_bit") === true;
    }
    return false;
}

const locKey = (l) => `${l.x},${l.y},${l.z}`;

export function extinguishPortal(startBlockLocation, dimension) {
    const neighbors = [
        { x: startBlockLocation.x + 1, y: startBlockLocation.y, z: startBlockLocation.z },
        { x: startBlockLocation.x - 1, y: startBlockLocation.y, z: startBlockLocation.z },
        { x: startBlockLocation.x, y: startBlockLocation.y, z: startBlockLocation.z + 1 },
        { x: startBlockLocation.x, y: startBlockLocation.y, z: startBlockLocation.z - 1 }
    ];

    const airPermutation = BlockPermutation.resolve("minecraft:air");
    const visited = new Set();
    const queue = [];

    for (const loc of neighbors) {
        const bl = dimension.getBlock(loc);
        if (bl && bl.typeId === "minecraft:end_portal") {
            queue.push(loc);
            visited.add(locKey(loc));
        }
    }

    while (queue.length > 0) {
        const currentLoc = queue.shift();
        const block = dimension.getBlock(currentLoc);
        if (!block) continue;

        if (block.typeId === "minecraft:end_portal") {
            block.setPermutation(airPermutation);
            const nextNeighbors = [
                { x: currentLoc.x + 1, y: currentLoc.y, z: currentLoc.z },
                { x: currentLoc.x - 1, y: currentLoc.y, z: currentLoc.z },
                { x: currentLoc.x, y: currentLoc.y, z: currentLoc.z + 1 },
                { x: currentLoc.x, y: currentLoc.y, z: currentLoc.z - 1 }
            ];
            for (const n of nextNeighbors) {
                const k = locKey(n);
                if (!visited.has(k)) {
                    const nbBlock = dimension.getBlock(n);
                    if (nbBlock && nbBlock.typeId === "minecraft:end_portal") {
                        visited.add(k);
                        queue.push(n);
                    }
                }
            }
        }
    }
}

/**
 * Fungsi Pintar: Mengaktifkan/Memperbaiki portal dengan dukungan MIXED FRAMES.
 * Tidak lagi memaksa restore ke vanilla trigger, membiarkan custom frame tetap ada
 * tapi memaksa block portal (tengah) untuk tetap menyala.
 */
export function checkAndFillPortal(triggerBlock) {
    const dimension = triggerBlock.dimension;
    const startDirection = getFrameDirection(triggerBlock);
    const startOffset = FACING_OFFSETS[startDirection];
    
    if (!startOffset) return false;

    const startLoc = { 
        x: triggerBlock.location.x + startOffset.x, 
        y: triggerBlock.location.y, 
        z: triggerBlock.location.z 
    };

    const blocksToFill = [];
    const visited = new Set();
    const queue = [startLoc];
    
    let isValidStructure = true;
    visited.add(locKey(startLoc));

    while (queue.length > 0) {
        if (blocksToFill.length > MAX_PORTAL_SIZE) {
            isValidStructure = false; break;
        }

        const currentLoc = queue.shift();
        const currentBlock = dimension.getBlock(currentLoc);
        if (!currentBlock) { isValidStructure = false; break; }

        const typeId = currentBlock.typeId;

        if (typeId === "minecraft:air" || typeId === "minecraft:end_portal") {
            blocksToFill.push(currentLoc);

            const neighbors = [
                { x: currentLoc.x + 1, y: currentLoc.y, z: currentLoc.z },
                { x: currentLoc.x - 1, y: currentLoc.y, z: currentLoc.z },
                { x: currentLoc.x, y: currentLoc.y, z: currentLoc.z + 1 },
                { x: currentLoc.x, y: currentLoc.y, z: currentLoc.z - 1 }
            ];

            for (const neighbor of neighbors) {
                const key = locKey(neighbor);
                if (!visited.has(key)) {
                    visited.add(key);
                    queue.push(neighbor);
                }
            }
        } 
        else if (isValidFrameWithEye(currentBlock)) {
            const frameDir = getFrameDirection(currentBlock);
            const frameOffset = FACING_OFFSETS[frameDir];
            const facingTargetLoc = {
                x: currentBlock.location.x + frameOffset.x,
                y: currentBlock.location.y,
                z: currentBlock.location.z + frameOffset.z
            };
            
            const isFacingInterior = visited.has(locKey(facingTargetLoc));

            if (!isFacingInterior) {
                const facingBlock = dimension.getBlock(facingTargetLoc);
                const isLookingAtVoid = facingBlock.typeId === "minecraft:air" || facingBlock.typeId === "minecraft:end_portal";
                
                if (!isLookingAtVoid) {
                    isValidStructure = false;
                    break;
                }
            }
            continue;
        } 
        else {
            isValidStructure = false;
            break; 
        }
    }

    if (isValidStructure && blocksToFill.length > 0) {
        const portalPermutation = BlockPermutation.resolve("minecraft:end_portal");
        let hasChanged = false;

        for (const loc of blocksToFill) {
            const block = dimension.getBlock(loc);
            // Paksa set portal, bahkan jika engine vanilla mencoba menghapusnya karena melihat "custom block"
            if (block.typeId !== "minecraft:end_portal") { 
                block.setPermutation(portalPermutation);
                hasChanged = true;
            }
        }
        return true;
    }
    
    return false;
}