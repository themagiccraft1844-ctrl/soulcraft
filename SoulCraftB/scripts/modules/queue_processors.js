// BP/scripts/modules/queue_processors.js

import { system, BlockPermutation } from '@minecraft/server';
import { getUniqueKeyFromLocation } from './location_utils'; // Impor helper

// Antrean dipisahkan berdasarkan prioritas iklim
export const freezeQueues = {
    cold: [],      // Prioritas tinggi (cepat)
    temperate: [], // Prioritas normal
    warm: []       // Prioritas rendah (lambat)
};

export const meltQueues = {
    warm: [],      // Prioritas tinggi (cepat)
    temperate: [], // Prioritas normal
    cold: []       // Prioritas rendah (lambat)
};

let processorIntervalId = null;

// Konfigurasi kecepatan berdasarkan prioritas
const BATCH_SIZES = {
    fast: 25,
    normal: 15,
    slow: 5
};
const TICK_INTERVAL = 2;

/**
 * PERUBAHAN: Membatalkan semua pekerjaan yang tertunda di LOKASI tertentu.
 * @param {import("@minecraft/server").Vector3} location - Lokasi di mana pekerjaan akan dibatalkan.
 */
export function cancelJobsAtLocation(location) {
    if (!location) return;
    const locationKey = getUniqueKeyFromLocation(location);
    console.log(`[Queue] Membatalkan semua pekerjaan di lokasi ${locationKey}`);
    
    // Fungsi filter untuk memeriksa apakah lokasi pekerjaan sama dengan lokasi target
    const filterByLocation = (job) => {
        if (!job.anchorData || !job.anchorData.location) return true; // Simpan pekerjaan tanpa data lokasi
        return getUniqueKeyFromLocation(job.anchorData.location) !== locationKey;
    };

    for (const queueType in freezeQueues) {
        freezeQueues[queueType] = freezeQueues[queueType].filter(filterByLocation);
    }
    for (const queueType in meltQueues) {
        meltQueues[queueType] = meltQueues[queueType].filter(filterByLocation);
    }
}


/**
 * Memulai prosesor antrean global jika belum berjalan.
 */
export function startQueueProcessor() {
    if (processorIntervalId) return;

    processorIntervalId = system.runInterval(() => {
        // --- Proses Antrean Pembekuan ---
        processQueue(freezeQueues.cold, BATCH_SIZES.fast);
        processQueue(freezeQueues.temperate, BATCH_SIZES.normal);
        processQueue(freezeQueues.warm, BATCH_SIZES.slow);

        // --- Proses Antrean Pencairan ---
        processQueue(meltQueues.warm, BATCH_SIZES.fast, false);
        processQueue(meltQueues.temperate, BATCH_SIZES.normal, false);
        processQueue(meltQueues.cold, BATCH_SIZES.slow, false);

        // Hentikan interval jika semua pekerjaan selesai
        const allQueuesEmpty = Object.values(freezeQueues).every(q => q.length === 0) &&
                               Object.values(meltQueues).every(q => q.length === 0);

        if (allQueuesEmpty) {
            system.clearRun(processorIntervalId);
            processorIntervalId = null;
        }
    }, TICK_INTERVAL);
}

/**
 * Fungsi bantuan untuk memproses sebagian dari antrean.
 * @param {Array<any>} queue - Antrean yang akan diproses.
 * @param {number} batchSize - Jumlah item maksimum untuk diproses.
 * @param {boolean} isFreezing - Menandakan apakah ini proses pembekuan (untuk melacak es).
 */
function processQueue(queue, batchSize, isFreezing = true) {
    let processedCount = 0;
    while (queue.length > 0 && processedCount < batchSize) {
        const job = queue.shift();
        const { block, permutation, anchorData } = job;
        
        try {
            const isCorrectBlockType = isFreezing 
                ? (block.typeId === "minecraft:water" || block.typeId === "minecraft:flowing_water")
                : block.typeId === "minecraft:ice";

            if (block.isValid && isCorrectBlockType) {
                block.setPermutation(permutation);
                if (isFreezing && anchorData && anchorData.freezingManager) {
                    // Lacak es yang baru dibuat
                    anchorData.freezingManager.trackCreatedIce(block.location, (block.typeId === "minecraft:water"));
                }
            }
        } catch (e) { /* Abaikan */ }
        processedCount++;
    }
}
