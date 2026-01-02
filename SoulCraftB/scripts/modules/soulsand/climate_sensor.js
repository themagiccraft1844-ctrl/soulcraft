// BP/scripts/modules/climate_sensor.js

import { world, system, Entity } from '@minecraft/server';

const SENSOR_ENTITY_ID = "soulcraft:temp_sensor";
const DESPAWN_EVENT_NAME = "soulcraft:trigger_despawn";

function mapVariantToClimate(variantValue) {
    switch (variantValue) {
        case 0: return "warm";
        case 1: return "cold";
        case 2: return "temperate";
        default: return "unknown";
    }
}

/**
 * Mencari sensor. Jika tidak ada, SPAWN BARU.
 * Dibuat sangat robust untuk menangani chunk reload.
 */
export async function getOrCreateClimateSensor(location, dimension) {
    if (dimension.id !== "minecraft:overworld") {
        return null; // Nether/End handling berbeda
    }

    // 1. Cari yang existing (instant check)
    // Gunakan lokasi tengah untuk pencarian yang lebih akurat
    const centerLoc = {
        x: location.x + 0.5,
        y: location.y,
        z: location.z + 0.5
    };

    try {
        const existingSensors = dimension.getEntities({
            type: SENSOR_ENTITY_ID,
            location: centerLoc,
            maxDistance: 1.5 // Radius kecil karena posisi sudah akurat
        });

        if (existingSensors.length > 0) {
            const sensor = existingSensors[0];
            if (sensor.isValid) {
                // Cek apakah varian sudah siap
                const variant = sensor.getComponent("minecraft:variant");
                if (variant && typeof variant.value === 'number') {
                    return sensor;
                }
            }
        }
    } catch (e) { /* Chunk loading error possible */ }

    // 2. Jika tidak ada, Spawn baru
    // PERBAIKAN: Gunakan centerLoc agar spawn tepat di tengah blok
    try {
        const newSensor = dimension.spawnEntity(SENSOR_ENTITY_ID, centerLoc);
        
        // Tunggu komponen variant siap (async)
        return new Promise((resolve) => {
            let ticks = 0;
            const interval = system.runInterval(() => {
                ticks++;
                if (!newSensor.isValid) {
                    system.clearRun(interval);
                    resolve(null); 
                    return;
                }

                const variant = newSensor.getComponent("minecraft:variant");
                if (variant && typeof variant.value === 'number') {
                    system.clearRun(interval);
                    resolve(newSensor);
                }

                if (ticks > 40) { // Timeout 2 detik
                    system.clearRun(interval);
                    try { newSensor.remove(); } catch(e){}
                    resolve(null);
                }
            }, 2);
        });

    } catch (e) {
        return null;
    }
}

export function getClimateVariantFromSensor(sensorEntity) {
    if (sensorEntity && sensorEntity.isValid) {
        const variantComponent = sensorEntity.getComponent("minecraft:variant");
        if (variantComponent && typeof variantComponent.value === 'number') {
            return mapVariantToClimate(variantComponent.value);
        }
    }
    return null;
}

export function removeClimateSensor(locationOrEntity, dimension = null) {
    if (locationOrEntity instanceof Entity) {
        try {
            locationOrEntity.triggerEvent(DESPAWN_EVENT_NAME);
            system.runTimeout(() => {
                if(locationOrEntity.isValid) locationOrEntity.remove();
            }, 5);
        } catch (e) {}
    } else if (dimension) {
        // Remove by location (Convert to center first for better accuracy)
        const centerLoc = {
            x: locationOrEntity.x + 0.5,
            y: locationOrEntity.y,
            z: locationOrEntity.z + 0.5
        };
        try {
            const sensors = dimension.getEntities({
                type: SENSOR_ENTITY_ID,
                location: centerLoc,
                maxDistance: 1.5
            });
            sensors.forEach(s => {
                try { s.triggerEvent(DESPAWN_EVENT_NAME); } catch(e){}
                system.runTimeout(() => { if(s.isValid) s.remove(); }, 5);
            });
        } catch(e) {}
    }
}