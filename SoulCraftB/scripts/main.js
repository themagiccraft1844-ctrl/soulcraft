import { world, system } from "@minecraft/server";
import './modules/soulsand/empty_soul_sand_logic.js'; 
import { handlePurificationInteraction } from "./modules/soulsand/puring_logic.js";
import { setupWardenRitual } from "./modules/summon/warden.js";

setupWardenRitual();

import "./modules/mechanics/break_portal.js";

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    system.run(() => {
        handlePurificationInteraction(event);
    });
});

console.warn("SoulCraft Addon Loaded - Purification System Online");