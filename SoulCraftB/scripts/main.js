import { world, system } from "@minecraft/server";
import './modules/empty_soul_sand_logic.js'; 
import { handlePurificationInteraction } from "./modules/puring_logic.js";

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    system.run(() => {
        handlePurificationInteraction(event);
    });
});

console.warn("SoulCraft Addon Loaded - Purification System Online");