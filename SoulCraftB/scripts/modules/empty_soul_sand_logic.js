// BP/scripts/modules/empty_soul_sand_logic.js

import { world, system, BlockPermutation } from "@minecraft/server";
import { getUniqueKeyFromLocation, isBlockAnchored, distanceSquared } from './location_utils'; 
import { 
    getOrCreateClimateSensor, 
    removeClimateSensor,
    getClimateVariantFromSensor
} from "./climate_sensor"; 

import { FreezingManager } from "./freeze_utils"; 
import { cleanupWaterOnAnchorBreak } from "./keeps_water_utils"; 
import { handleNetherWaterPlacement } from "./nether_water_placement.js";
import { unregisterRandomTickJob } from "./queue_processors.js";

// --- KONFIGURASI ---
const SOUL_SAND_ID = "minecraft:soul_sand";
const REQUIRED_DEATHS = 4;

const BLOCK_ID = "soulcraft:empty_soul_sand";
const QUARTER_SOUL_SAND = "soulcraft:quarter_soul_sand";
const HALF_SOUL_SAND = "soulcraft:half_soul_sand";
const ALMOST_FULL_SOUL_SAND = "soulcraft:almost_full_soul_sand";

const SOUL_SAND_BLOCK_TYPES = [
    BLOCK_ID, 
    QUARTER_SOUL_SAND, 
    HALF_SOUL_SAND, 
    ALMOST_FULL_SOUL_SAND
];

// Map Utama: Key = "x,y,z", Value = SoulSandData Instance
let activeMakers = new Map(); 

class SoulSandData {
    constructor(location, dimension, initialDeathCount = 0) {
        this.location = location;
        this.dimension = dimension;
        this.deathCount = initialDeathCount;
        this.sensorEntityId = null;
        
        if (this.dimension.id !== "minecraft:nether") {
            this.freezingManager = new FreezingManager(this.location, this.dimension, activeMakers);
        } else {
            this.freezingManager = null;
        }
    }

    async getClimateVariant() {
        if (this.dimension.id === "minecraft:the_end") return "temperate";
        if (this.dimension.id === "minecraft:nether") return "warm";

        let sensor = null;
        if (this.sensorEntityId) sensor = world.getEntity(this.sensorEntityId);
        if (!sensor || !sensor.isValid) {
            sensor = await getOrCreateClimateSensor(this.location, this.dimension);
            if (sensor) this.sensorEntityId = sensor.id;
        }

        return getClimateVariantFromSensor(sensor) || "temperate";
    }

    async refreshBehavior() {
        if (!this.freezingManager) return;
        const climate = await this.getClimateVariant();
        this.freezingManager.triggerSmartFreezeScan(climate);
    }

    addDeath() {
        this.deathCount++;
        const block = this.dimension.getBlock(this.location);
        
        if (block && block.isValid) {
            const newBlockMap = { 1: QUARTER_SOUL_SAND, 2: HALF_SOUL_SAND, 3: ALMOST_FULL_SOUL_SAND, 4: SOUL_SAND_ID };
            const newBlockId = newBlockMap[this.deathCount];
            if (newBlockId) {
                if (this.deathCount >= REQUIRED_DEATHS) {
                    this.convertToSoulSand();
                } else {
                    system.run(() => {
                        if(block.isValid) block.setPermutation(BlockPermutation.resolve(newBlockId));
                    });
                }
            }
        }
    }

    async convertToSoulSand() {
        const { location, dimension, freezingManager } = this;
        const climate = await this.getClimateVariant();
        this.cleanup();

        system.run(() => {
            const block = dimension.getBlock(location);
            if (block && block.isValid) block.setPermutation(BlockPermutation.resolve(SOUL_SAND_ID));
        });

        if (dimension.id === "minecraft:nether") {
            cleanupWaterOnAnchorBreak(location, dimension, activeMakers);
        } else if (freezingManager) {
            freezingManager.triggerMeltProcess(climate);
        }
    }

    cleanup() {
        const key = getUniqueKeyFromLocation(this.location);
        unregisterRandomTickJob(key);
        activeMakers.delete(key);
        if (this.dimension.id === "minecraft:overworld") {
            removeClimateSensor(this.location, this.dimension);
        }
    }
}

// --- INITIALIZATION ---

function registerAnchor(block, dimension) {
    const key = getUniqueKeyFromLocation(block.location);
    if (activeMakers.has(key)) return activeMakers.get(key);

    const deathCount = SOUL_SAND_BLOCK_TYPES.indexOf(block.typeId);
    const data = new SoulSandData(block.location, dimension, deathCount);
    activeMakers.set(key, data);
    
    // Trigger behavior awal dengan delay
    system.runTimeout(() => { data.refreshBehavior(); }, 10);
    return data;
}

// --- RESTORATION LOGIC (RELOAD WORLD FIX) ---

function restoreStateFromSensors() {
    const dimensions = [world.getDimension('overworld'), world.getDimension('nether')];
    
    for (const dim of dimensions) {
        try {
            const sensors = dim.getEntities({ type: "soulcraft:temp_sensor" });
            
            for (const sensor of sensors) {
                if (!sensor.isValid) continue;
                
                const loc = sensor.location;
                try {
                    const block = dim.getBlock(loc);
                    if (block && SOUL_SAND_BLOCK_TYPES.includes(block.typeId)) {
                        const key = getUniqueKeyFromLocation(loc);
                        if (!activeMakers.has(key)) {
                            const data = registerAnchor(block, dim);
                            data.sensorEntityId = sensor.id;
                        }
                    } else {
                        removeClimateSensor(sensor);
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }
}

function scanAreaAround(center, dimension, radius) {
    const rangeY = 8; 
    
    for (let x = -radius; x <= radius; x++) {
        for (let y = -rangeY; y <= rangeY; y++) {
            for (let z = -radius; z <= radius; z++) {
                const loc = { 
                    x: Math.floor(center.x + x), 
                    y: Math.floor(center.y + y), 
                    z: Math.floor(center.z + z) 
                };

                try {
                    const block = dimension.getBlock(loc);
                    if (block && SOUL_SAND_BLOCK_TYPES.includes(block.typeId)) {
                        const key = getUniqueKeyFromLocation(loc);
                        if (!activeMakers.has(key)) {
                            registerAnchor(block, dimension);
                        }
                    }
                } catch (e) {}
            }
        }
    }
}

// --- EVENT HANDLERS ---

world.afterEvents.playerSpawn.subscribe((event) => {
    scanAreaAround(event.player.location, event.player.dimension, 8);
    restoreStateFromSensors();
});


world.afterEvents.playerPlaceBlock.subscribe(async (event) => {
    if (SOUL_SAND_BLOCK_TYPES.includes(event.block.typeId)) {
        const data = registerAnchor(event.block, event.dimension);
        await data.getClimateVariant();
        data.refreshBehavior();
    } else {
        checkNearbyAndTrigger(event.block.location, event.dimension);
    }
});

world.afterEvents.playerBreakBlock.subscribe((event) => {
    const { brokenBlockPermutation, block, dimension } = event;
    
    if (SOUL_SAND_BLOCK_TYPES.includes(brokenBlockPermutation.type.id)) {
        const key = getUniqueKeyFromLocation(block.location);
        
        const tempManager = new FreezingManager(block.location, dimension, activeMakers);
        tempManager.triggerMeltProcess("temperate"); 
        
        removeClimateSensor(block.location, dimension);
        activeMakers.delete(key);

        if (dimension.id === "minecraft:nether") {
            cleanupWaterOnAnchorBreak(block.location, dimension, activeMakers);
        }
    } else {
        checkNearbyAndTrigger(block.location, dimension);
    }
});

// [PERBAIKAN ERROR]: Logic ini berjalan di beforeEvents (read-only)
// Fungsi checkNearbyAndTrigger bisa memicu spawnEntity (lewat registerAnchor -> getClimateSensor)
// Jadi harus di-defer (system.run) agar tidak crash.
world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (event.player.dimension.id === "minecraft:nether" && event.itemStack?.typeId === "minecraft:water_bucket") {
        // handleNetherWaterPlacement sudah menangani deferral di dalamnya sendiri untuk side-effects
        handleNetherWaterPlacement(event, activeMakers, SOUL_SAND_BLOCK_TYPES, SoulSandData, null);
    }
    
    // Bungkus trigger update ini agar berjalan di tick berikutnya (safe context)
    system.run(() => {
        try {
            checkNearbyAndTrigger(event.block.location, event.player.dimension);
        } catch(e) {}
    });
});

world.afterEvents.entityDie.subscribe((event) => {
    const { deadEntity } = event;
    if (!deadEntity.isValid) return;

    const dim = deadEntity.dimension;
    const loc = deadEntity.location;
    let found = false;
    
    for (const [key, data] of activeMakers) {
        if (data.dimension.id !== dim.id) continue;
        if (distanceSquared(loc, data.location) <= 49) { 
            data.addDeath();
            try { dim.spawnParticle("minecraft:soul_particle", loc); } catch(e){}
            found = true;
            break; 
        }
    }
});

function checkNearbyAndTrigger(location, dimension) {
    const range = 6;
    for (const [key, data] of activeMakers) {
        if (data.dimension.id !== dimension.id) continue;
        if (distanceSquared(location, data.location) <= (range * range)) {
            data.refreshBehavior();
        }
    }
    scanAreaAround(location, dimension, 3);
}

// --- INTERVAL GLOBAL & CLEANUP ---

let tickCount = 0;

system.runInterval(() => {
    tickCount++;
    const dimensions = [world.getDimension('overworld'), world.getDimension('nether'), world.getDimension('the_end')];
    
    if (tickCount % 40 === 0) {
        restoreStateFromSensors();
    }

    for (const dim of dimensions) {
        try {
            for(const player of dim.getPlayers()) {
                 const xpOrbs = dim.getEntities({ type: "minecraft:xp_orb", location: player.location, maxDistance: 10 });
                 for (const orb of xpOrbs) {
                    if(!orb.isValid) continue;
                    let kill = false;
                    for (const [key, maker] of activeMakers) {
                        if(maker.dimension.id !== dim.id) continue;
                        if(distanceSquared(orb.location, maker.location) <= 49) {
                            kill = true; break;
                        }
                    }
                    if(kill) try{orb.remove();}catch(e){}
                }

                if (dim.id !== "minecraft:nether") { 
                    const rX = Math.floor(Math.random() * 10) - 5;
                    const rY = Math.floor(Math.random() * 6) - 3; 
                    const rZ = Math.floor(Math.random() * 10) - 5;
                    
                    const scanLoc = {
                        x: player.location.x + rX,
                        y: player.location.y + rY,
                        z: player.location.z + rZ
                    };

                    try {
                        const block = dim.getBlock(scanLoc);
                        if(block && block.isValid && block.typeId === "minecraft:ice") {
                            const anchored = isBlockAnchored(scanLoc, dim, activeMakers, null, 6);
                            if (!anchored) {
                                if (Math.random() < 0.2) { 
                                    block.setPermutation(BlockPermutation.resolve("minecraft:flowing_water"));
                                }
                            }
                        }
                    } catch(e) {}
                }
            }
        } catch(e) {}
    }
}, 10);