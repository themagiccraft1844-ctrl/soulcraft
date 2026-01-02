import { world } from "@minecraft/server";

export function setupWardenRitual() {
    world.afterEvents.playerPlaceBlock.subscribe((event) => {
        const { block, dimension } = event;

        if (block.typeId === "minecraft:lit_pumpkin") {
            const { x, y, z } = block.location;

            const b1 = dimension.getBlock({ x, y: y - 1, z });
            const b2 = dimension.getBlock({ x, y: y - 2, z });
            const b3 = dimension.getBlock({ x, y: y - 3, z });

            if (b1?.typeId === "minecraft:gold_block" && 
                b2?.typeId === "minecraft:gold_block" && 
                b3?.typeId === "minecraft:gold_block") {
                
                // Eksekusi pembersihan dan pemanggilan
                [0, 1, 2, 3].forEach(offset => {
                    dimension.setBlockType({ x, y: y - offset, z }, "minecraft:air");
                });

                dimension.spawnEntity("minecraft:warden", { x, y: y - 3, z });
            }
        }
    });
}