// BP/scripts/modules/empty_soul_sand_logic.js

import { world, system, BlockPermutation, LiquidType } from "@minecraft/server";
import { distanceSquared, getUniqueKeyFromLocation, isBlockAnchored } from './location_utils'; 
import { 
    getOrCreateClimateSensor, 
    removeClimateSensor,
    getClimateVariantFromSensor
} from "./climate_sensor"; 

import { FreezingManager } from "./freeze_utils"; 
import { cleanupWaterOnAnchorBreak } from "./keeps_water_utils"; 
import { handleNetherWaterPlacement } from "./nether_water_placement.js";
import { cancelJobsAtLocation } from "./queue_processors.js";

console.log(`[DEBUG empty_soul_sand_logic] Script empty_soul_sand_logic.js mulai dimuat di top-level. Tick: ${system.currentTick}`);


// --- Variabel Konfigurasi dan Global untuk Logika Empty Soul Sand ---
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

const SENSOR_ENTITY_ID = "soulcraft:temp_sensor";
let activeMakers = new Map(); 
const soulSandTickHandlers = new Map();

const pendingBreakConfirmations = new Map();
const CONFIRMATION_TIMEOUT_TICKS = 100; 

const CONFIG = {
    ANCHOR_CHECK_RADIUS: 5, 
    XP_ORB_KILL_RADIUS: 7, 
    WATER_REMOVE_RADIUS_ON_BREAK: 8, 
    WATER_REMOVAL_BATCH_SIZE: 10,
};


// --- Kelas SoulSandData (Logika Inti untuk Setiap Anchor) ---
class SoulSandData {
    constructor(location, dimension, tickHandlerId, climateSensorId = null, initialDeathCount = 0) {
        this.location = location;
        this.dimension = dimension;
        this.tickHandler = tickHandlerId;
        this.deathCount = initialDeathCount;
        this._climateSensorId = climateSensorId;

        if (this.dimension.id !== "minecraft:nether") {
            this.freezingManager = new FreezingManager(this.location, this.dimension, activeMakers);
        } else {
            this.freezingManager = null;
        }
    }

    _getClimateSensorEntity() {
        if (this.dimension.id === "minecraft:nether") return null;
        if (this._climateSensorId) {
            try {
                const sensor = world.getEntity(this._climateSensorId);
                if (sensor && sensor.isValid) return sensor;
            } catch (e) {}
        }
        return null;
    }

    async getClimateVariant() {
        if (this.dimension.id === "minecraft:the_end") return "temperate";
        if (this.dimension.id === "minecraft:overworld") {
            let currentSensor = this._getClimateSensorEntity();
            if (!currentSensor || !currentSensor.isValid) {
                currentSensor = await getOrCreateClimateSensor(this.location, this.dimension);
                this._climateSensorId = currentSensor ? currentSensor.id : null;
            }
            return getClimateVariantFromSensor(currentSensor) || "temperate";
        }
        return "temperate";
    }

    async handleBehavior() { 
        // Fungsi ini sengaja dikosongkan untuk performa, karena pembekuan
        // sekarang dipicu oleh event. Namun, fungsi ini tetap ada untuk
        // menjaga struktur dan stabilitas re-registrasi.
    }

    addDeath() {
        this.deathCount++;
        const block = this.dimension.getBlock(this.location);
        if (block && block.isValid) {
            const newBlockMap = { 1: QUARTER_SOUL_SAND, 2: HALF_SOUL_SAND, 3: ALMOST_FULL_SOUL_SAND, 4: SOUL_SAND_ID };
            const newBlockId = newBlockMap[this.deathCount];
            if (newBlockId) {
                if (this.deathCount >= REQUIRED_DEATHS) this.convertToSoulSand();
                else system.run(() => block.setPermutation(BlockPermutation.resolve(newBlockId)));
            }
        }
    }

    _cleanupHandlersAndData() {
        const key = getUniqueKeyFromLocation(this.location);
        if (this.tickHandler) {
            system.clearRun(this.tickHandler);
            soulSandTickHandlers.delete(key);
            this.tickHandler = null;
        }
        activeMakers.delete(key);
        if (this.dimension.id === "minecraft:overworld" && this._climateSensorId) {
            const sensorEntity = this._getClimateSensorEntity();
            if (sensorEntity && sensorEntity.isValid) removeClimateSensor(sensorEntity);
        }
    }

    async convertToSoulSand() { 
        const { location, dimension, freezingManager } = this;
        const climate = await this.getClimateVariant();
        this._cleanupHandlersAndData(); 
        system.run(() => {
            const block = dimension.getBlock(location);
            if (block && block.isValid) block.setPermutation(BlockPermutation.resolve(SOUL_SAND_ID));
        });
        cleanupWaterOnAnchorBreak(location, dimension, activeMakers);
        if (freezingManager) freezingManager.triggerMeltProcess(climate, this);
    }
}

async function autoSpawnMissingSensors() {
    for (const [key, makerData] of activeMakers.entries()) {
        if (makerData.dimension.id === "minecraft:nether") continue;
        try {
            const block = makerData.dimension.getBlock(makerData.location);
            if (!block || !block.isValid || !SOUL_SAND_BLOCK_TYPES.includes(block.typeId)) {
                makerData._cleanupHandlersAndData();
                continue;
            }
            let sensorEntity = makerData._getClimateSensorEntity();
            if (!sensorEntity || !sensorEntity.isValid) {
                const newSensor = await getOrCreateClimateSensor(makerData.location, makerData.dimension);
                if (newSensor && newSensor.isValid) makerData._climateSensorId = newSensor.id;
            }
        } catch(e) {}
    }
}

// --- Pemicu Pemindaian ---
async function triggerScanForAnchor(anchorData) {
    if (anchorData && anchorData.freezingManager) {
        const climate = await anchorData.getClimateVariant();
        anchorData.freezingManager.triggerSmartFreezeScan(climate, anchorData);
    }
}

// --- World Initialization & Cleanup ---
async function initializeExistingEmptySoulSandBlocks() {
    const dimensions = [world.getDimension('overworld'), world.getDimension('the_end')];
    for (const dim of dimensions) {
        try {
            const sensors = dim.getEntities({ type: SENSOR_ENTITY_ID });
            for (const sensor of sensors) {
                if (!sensor.isValid) continue;
                try {
                    const block = dim.getBlock(sensor.location);
                    if (block && SOUL_SAND_BLOCK_TYPES.includes(block.typeId)) {
                        const key = getUniqueKeyFromLocation(block.location);
                        if (!activeMakers.has(key)) {
                            const deathCount = SOUL_SAND_BLOCK_TYPES.indexOf(block.typeId);
                            const tickHandler = system.runInterval(() => {
                                if (activeMakers.has(key)) activeMakers.get(key).handleBehavior();
                            }, 5);
                            const anchorData = new SoulSandData(block.location, dim, tickHandler, sensor.id, deathCount);
                            activeMakers.set(key, anchorData);
                            soulSandTickHandlers.set(key, tickHandler);
                            
                            // PERUBAHAN: Panggil fungsi pemulihan es dan pemicu pembekuan
                            if (anchorData.freezingManager) {
                                anchorData.freezingManager.repopulateIceDataOnReload();
                            }
                            await triggerScanForAnchor(anchorData);
                        }
                    } else {
                        removeClimateSensor(sensor);
                    }
                } catch (e) {}
            }
        }
        catch (e) {}
    }
}

system.runTimeout(() => {
    system.runTimeout(() => {
        initializeExistingEmptySoulSandBlocks();
    }, 40);

    let playerInteractWithBlockSubscribeIntervalId = system.runInterval(() => {
        world.beforeEvents.playerInteractWithBlock.subscribe(async (event) => {
            const { player, itemStack, block } = event;
            if (player.dimension.id === "minecraft:nether" && itemStack?.typeId === "minecraft:water_bucket") {
                handleNetherWaterPlacement(event, activeMakers, SOUL_SAND_BLOCK_TYPES, SoulSandData, soulSandTickHandlers);
            }
            const anchorData = findNearbyAnchor(block.location, block.dimension);
            if (anchorData) await triggerScanForAnchor(anchorData);
        });
        system.clearRun(playerInteractWithBlockSubscribeIntervalId);
    }, 1);

    system.runInterval(() => {
        const currentTick = system.currentTick;
        for (const [key, data] of pendingBreakConfirmations.entries()) {
            if (currentTick - data.timestamp > CONFIRMATION_TIMEOUT_TICKS) {
                pendingBreakConfirmations.delete(key);
            }
        }
    }, 20); 

    world.afterEvents.playerPlaceBlock.subscribe(async (event) => { 
        if (event.block.typeId === BLOCK_ID) {
            const { block } = event;
            const key = getUniqueKeyFromLocation(block.location);
            cancelJobsAtLocation(block.location);
            let climateSensorEntity = null;
            if (block.dimension.id !== "minecraft:nether") {
                climateSensorEntity = await getOrCreateClimateSensor(block.location, block.dimension);
            }
            const tickHandler = system.runInterval(() => {
                if (activeMakers.has(key)) {
                    activeMakers.get(key).handleBehavior();
                }
            }, 5);
            const anchorData = new SoulSandData(block.location, block.dimension, tickHandler, climateSensorEntity?.id, 0);
            activeMakers.set(key, anchorData);
            soulSandTickHandlers.set(key, tickHandler);
            await triggerScanForAnchor(anchorData);
        } else {
            const anchorData = findNearbyAnchor(event.block.location, event.dimension);
            if (anchorData) await triggerScanForAnchor(anchorData);
        }
    });

    world.beforeEvents.playerBreakBlock.subscribe((event) => {
        const { block } = event;
        const blockLocationKey = getUniqueKeyFromLocation(block.location);
        if (SOUL_SAND_BLOCK_TYPES.includes(block.typeId)) {
            if (!activeMakers.has(blockLocationKey)) {
                console.warn(`[RECOVERY_WARN] Menghancurkan blok kustom tak terlacak di ${blockLocationKey}. Mencoba mendaftarkan ulang.`);
                let deathCount = SOUL_SAND_BLOCK_TYPES.indexOf(block.typeId);
                const tickHandler = system.runInterval(() => {
                    if (activeMakers.has(blockLocationKey)) activeMakers.get(blockLocationKey).handleBehavior();
                }, 5);
                const soulSandData = new SoulSandData(block.location, event.dimension, tickHandler, null, deathCount);
                activeMakers.set(blockLocationKey, soulSandData);
                soulSandTickHandlers.set(blockLocationKey, tickHandler);
            }
        }
    });

    world.afterEvents.playerBreakBlock.subscribe(async (event) => {
        system.runTimeout(async () => {
            const { brokenBlockPermutation, dimension, block } = event;
            const key = getUniqueKeyFromLocation(block.location);
            if (SOUL_SAND_BLOCK_TYPES.includes(brokenBlockPermutation.type.id)) {
                const anchorData = activeMakers.get(key);
                if (anchorData) {
                    const climate = await anchorData.getClimateVariant();
                    if (anchorData.freezingManager) anchorData.freezingManager.triggerMeltProcess(climate, anchorData);
                    anchorData._cleanupHandlersAndData();
                    cleanupWaterOnAnchorBreak(block.location, dimension, activeMakers);
                }
            } else {
                const anchorData = findNearbyAnchor(block.location, dimension);
                if (anchorData) await triggerScanForAnchor(anchorData);
            }
        }, 1);
    });

    world.afterEvents.entityDie.subscribe((event) => {
        const deadEntity = event.deadEntity;
        if (deadEntity && deadEntity.isValid && deadEntity.hasComponent('minecraft:health')) { 
            const mobLocation = { x: deadEntity.location.x, y: deadEntity.location.y, z: deadEntity.location.z };
            const mobDimension = deadEntity.dimension;
            let foundRelevantMaker = false;
            if (mobDimension.id !== "minecraft:nether") {
                for (const [key, makerData] of activeMakers.entries()) { 
                    if (makerData.dimension.id !== deadEntity.dimension.id) continue;
                    const distSq = distanceSquared(mobLocation, makerData.location);
                    if (!isNaN(distSq) && distSq <= 49) {
                        makerData.addDeath();
                        try { mobDimension.spawnParticle("minecraft:soul_particle", mobLocation); } catch (e) {}
                        foundRelevantMaker = true;
                        break;
                    }
                }
            }
            else {
                const scanRadius = 7;
                const startScan = { x: Math.floor(mobLocation.x) - scanRadius, y: Math.floor(mobLocation.y) - scanRadius, z: Math.floor(mobLocation.z) - scanRadius };
                const endScan = { x: Math.floor(mobLocation.x) + scanRadius, y: Math.floor(mobLocation.y) + scanRadius, z: Math.floor(mobLocation.z) + scanRadius };
                try {
                    for (let x = startScan.x; x <= endScan.x; x++) {
                        for (let y = startScan.y; y <= endScan.y; y++) {
                            for (let z = startScan.z; z <= endScan.z; z++) {
                                const block = mobDimension.getBlock({ x, y, z });
                                if (block && block.isValid && SOUL_SAND_BLOCK_TYPES.includes(block.typeId)) {
                                    const key = getUniqueKeyFromLocation(block.location);
                                    let makerData = activeMakers.get(key);
                                    if (!makerData) {
                                        let deathCount = SOUL_SAND_BLOCK_TYPES.indexOf(block.typeId);
                                        const tickHandler = system.runInterval(() => {
                                            if (activeMakers.has(key)) activeMakers.get(key).handleBehavior();
                                        }, 5);
                                        makerData = new SoulSandData(block.location, mobDimension, tickHandler, null, deathCount);
                                        activeMakers.set(key, makerData);
                                        soulSandTickHandlers.set(key, tickHandler);
                                    }
                                    makerData.addDeath();
                                    try { mobDimension.spawnParticle("minecraft:soul_particle", mobLocation); } catch (e) {}
                                    foundRelevantMaker = true;
                                    break;
                                }
                            }
                            if (foundRelevantMaker) break;
                        }
                        if (foundRelevantMaker) break;
                    }
                } catch (e) {}
            }
        }
    });

    system.runInterval(() => {
        const dimensions = [world.getDimension('overworld'), world.getDimension('nether'), world.getDimension('the_end')];
        for (const dim of dimensions) {
            try {
                for (const [key, makerData] of activeMakers.entries()) {
                    if (makerData.dimension.id !== dim.id) continue;
                    const nearbyOrbs = dim.getEntities({ type: "minecraft:xp_orb", location: makerData.location, maxDistance: 7 });
                    for (const orb of nearbyOrbs) {
                        if (orb.isValid) orb.remove();
                    }
                }
            } catch (e) { /* ignore */ }
        }
    }, 10);
}, 1);

function findNearbyAnchor(location, dimension, radius = 5) {
    for (const [key, anchor] of activeMakers.entries()) {
        if (anchor.dimension.id === dimension.id) {
            const dx = Math.abs(anchor.location.x - location.x);
            const dy = Math.abs(anchor.location.y - location.y);
            const dz = Math.abs(anchor.location.z - location.z);
            if (dx <= radius && dy <= radius && dz <= radius) return anchor;
        }
    }
    return null;
}
    
system.runInterval(() => {
    try {
        autoSpawnMissingSensors();
    } catch (e) {
        console.error(`[RECOVERY_FATAL] Error saat menjalankan autoSpawnMissingSensors: ${e.message}`);
    }
}, 600);
