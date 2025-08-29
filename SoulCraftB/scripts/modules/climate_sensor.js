// BP/scripts/modules/climate_sensor.js

import { world, system, Entity, BlockPermutation } from '@minecraft/server'; // Import Entity dan BlockPermutation untuk type hinting

const SENSOR_ENTITY_ID = "soulcraft:temp_sensor"; // Ganti dengan ID entitas sensor iklim yang sesuai
const DESPAWN_EVENT_NAME = "soulcraft:trigger_despawn"; // Nama event kustom untuk despawn

/**
 * Helper function untuk memetakan nilai varian numerik ke string iklim.
 * @param {number} variantValue - Nilai varian dari komponen minecraft:variant.
 * @returns {string} String iklim ("warm", "cold", "temperate").
 */
function mapVariantToClimate(variantValue) {
    switch (variantValue) {
        case 0: return "warm";
        case 1: return "cold";
        case 2: return "temperate";
        default: return "unknown"; // Fallback jika varian tidak sesuai
    }
}

/**
 * Mencari entitas sensor iklim yang sudah ada di lokasi tertentu.
 * Jika tidak ditemukan, akan men-spawn yang baru dan menunggu propertinya diatur.
 * Entitas sensor hanya di-spawn di Overworld.
 * @param {import("@minecraft/server").Vector3} location - Koordinat {x, y, z} untuk di-cek/di-spawn.
 * @param {import("@minecraft/server").Dimension} dimension - Dimensi tempat lokasi berada.
 * @param {boolean} [autoDespawn=false] - Jika true, sensor akan otomatis despawn setelah propertinya siap (hanya untuk pengujian, biasanya tidak digunakan di sini).
 * @returns {Promise<import("@minecraft/server").Entity | null>} Objek entitas sensor, atau null jika gagal atau bukan Overworld.
 */
export async function getOrCreateClimateSensor(location, dimension, autoDespawn = false) {
    // Sensor hanya relevan di Overworld. Di Nether/The End, tidak perlu spawn.
    if (dimension.id !== "minecraft:overworld") {
        return null;
    }

    // 1. Coba cari entitas sensor yang sudah ada di lokasi
    try {
        const existingSensors = dimension.getEntitiesAtBlockLocation(location); // Menggunakan getEntitiesAtBlockLocation
        const filteredSensors = existingSensors.filter(entity => entity.typeId === SENSOR_ENTITY_ID && entity.isValid);

        if (filteredSensors.length > 0) {
            const sensorEntity = filteredSensors[0];
            const variantComponent = sensorEntity.getComponent("minecraft:variant");
            if (variantComponent && typeof variantComponent.value === 'number') {
                return sensorEntity;
            } else {
                console.warn(`[ClimateSensor] Menemukan sensor lama tanpa komponen variant yang siap di ${location.x},${location.y},${location.z}. Mencoba memicu despawn dan mengembalikan null untuk spawn ulang.`);
                // Memastikan sensor yang tidak valid dihapus untuk menghindari duplikasi
                system.run(() => {
                    if (sensorEntity.isValid) {
                        try {
                            sensorEntity.triggerEvent(DESPAWN_EVENT_NAME);
                        } catch (e) {
                            console.error(`[ClimateSensor] Error triggering despawn for existing invalid sensor (${sensorEntity.id}): ${e.message}`);
                        }
                    }
                });
                return null;
            }
        }
    } catch (e) {
        console.error(`[ClimateSensor] Error mencari sensor yang sudah ada di ${location.x},${location.y},${location.z}: ${e.message}`);
    }

    // 2. Jika tidak ditemukan atau tidak valid, spawn yang baru
    let sensorEntity = null;
    try {
        sensorEntity = dimension.spawnEntity(SENSOR_ENTITY_ID, location);

        return new Promise(resolve => {
            const timeoutTicks = 100; // 5 detik
            let currentTicks = 0;
            const checkInterval = system.runInterval(() => {
                if (!sensorEntity.isValid) {
                    console.warn(`[ClimateSensor] Sensor tidak valid saat menunggu komponen variant di ${location.x},${location.y},${location.z}.`);
                    system.clearRun(checkInterval);
                    resolve(null);
                    return;
                }
                const variantComponent = sensorEntity.getComponent("minecraft:variant");
                if (variantComponent && typeof variantComponent.value === 'number') {
                    system.clearRun(checkInterval);

                    // Auto despawn jika diminta (misalnya untuk pengujian)
                    if (autoDespawn) {
                        system.run(() => {
                            if (sensorEntity.isValid) {
                                try {
                                    sensorEntity.triggerEvent(DESPAWN_EVENT_NAME);
                                } catch (e) {
                                    console.error(`[ClimateSensor] Error triggering despawn for new sensor (${sensorEntity.id}): ${e.message}`);
                                }
                            }
                        });
                    }

                    resolve(sensorEntity);
                }

                currentTicks++;
                if (currentTicks >= timeoutTicks) {
                    console.warn(`[ClimateSensor] Timeout menunggu komponen variant untuk sensor di ${location.x},${location.y},${location.z}.`);
                    system.clearRun(checkInterval);
                    // Hapus sensor jika timeout
                    if (sensorEntity.isValid) {
                        system.run(() => {
                            if (sensorEntity.isValid) {
                                try {
                                    sensorEntity.triggerEvent(DESPAWN_EVENT_NAME);
                                } catch (e) {
                                    console.error(`[ClimateSensor] Error triggering despawn after timeout for sensor (${sensorEntity.id}): ${e.message}`);
                                }
                            }
                        });
                    }
                    resolve(null);
                }
            }, 1);
        });

    } catch (e) {
        console.error(`[ClimateSensor] Gagal men-spawn atau mendapatkan sensor di ${location.x},${location.y},${location.z}: ${e.message}`);
        if (sensorEntity && sensorEntity.isValid) {
            // Coba hapus entitas jika spawn gagal
            system.run(() => {
                if (sensorEntity.isValid) {
                    try {
                        sensorEntity.triggerEvent(DESPAWN_EVENT_NAME);
                    } catch (e) {
                        console.error(`[ClimateSensor] Error triggering despawn on spawn failure for sensor (${sensorEntity.id}): ${e.message}`);
                    }
                }
            });
        }
        return null;
    }
}

/**
 * Mengambil nilai iklim dari entitas sensor.
 * @param {import("@minecraft/server").Entity} sensorEntity - Entitas sensor iklim.
 * @returns {string | null} String iklim ("warm", "cold", "temperate"), atau null jika tidak dapat dibaca.
 */
export function getClimateVariantFromSensor(sensorEntity) {
    if (sensorEntity && sensorEntity.isValid) {
        const variantComponent = sensorEntity.getComponent("minecraft:variant");
        if (variantComponent && typeof variantComponent.value === 'number') {
            return mapVariantToClimate(variantComponent.value);
        }
    }
    console.warn("[ClimateSensor] Sensor tidak valid atau tidak memiliki komponen variant.");
    return null;
}

/**
 * Menghapus entitas sensor iklim. Hanya berlaku untuk Overworld.
 * @param {import("@minecraft/server").Vector3 | import("@minecraft/server").Entity} locationOrEntity - Lokasi entitas sensor atau objek entitas itu sendiri.
 * @param {import("@minecraft/server").Dimension} [dimension=null] - Dimensi tempat entitas sensor berada (hanya diperlukan jika parameter pertama adalah lokasi).
 */
export function removeClimateSensor(locationOrEntity, dimension = null) {
    // Sensor hanya relevan di Overworld. Di Nether/The End, tidak ada yang perlu dihapus.
    if (dimension && dimension.id !== "minecraft:overworld") {
        return;
    }
    if (locationOrEntity instanceof Entity) { 
        const entity = locationOrEntity;
        system.run(() => {
            if (entity.isValid) { 
                try {
                    entity.triggerEvent(DESPAWN_EVENT_NAME);
                } catch (e) {
                    console.error(`[ClimateSensor] Error triggering despawn event for entity (${entity.id}): ${e.message}`);
                }
            } else {
                console.warn(`[ClimateSensor] Entitas sensor (${entity?.id || 'unknown'}) sudah tidak valid saat mencoba menghapus langsung (dalam system.run).`);
            }
        });
        return;
    }

    const location = locationOrEntity;
    const locationString = `${location.x},${location.y},${location.z}`;
    try {
        const existingSensors = dimension.getEntitiesAtBlockLocation(location); // Menggunakan getEntitiesAtBlockLocation
        const filteredSensors = existingSensors.filter(entity => entity.typeId === SENSOR_ENTITY_ID && entity.isValid);

        for (const entity of filteredSensors) { 
            system.run(() => {
                if (entity.isValid) { 
                    try {
                        entity.triggerEvent(DESPAWN_EVENT_NAME);
                    } catch (e) {
                        console.error(`[ClimateSensor] Error triggering despawn event for sensor at ${locationString} (fallback search): ${e.message}`);
                    }
                } else {
                    console.warn(`[ClimateSensor] Entitas sensor di ${locationString} (fallback search) sudah tidak valid saat mencoba menghapus (dalam system.run).`);
                }
            });
        }
        if (filteredSensors.length === 0) {
            console.warn(`[ClimateSensor] Tidak menemukan sensor valid untuk dihapus di ${locationString} (fallback search).`);
        }
    } catch (e) {
        console.error(`[ClimateSensor] Error memicu despawn sensor di ${locationString} (fallback search): ${e.message}`);
    }
}
