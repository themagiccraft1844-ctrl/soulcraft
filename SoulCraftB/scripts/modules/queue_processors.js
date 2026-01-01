// BP/scripts/modules/queue_processors.js

import { system } from '@minecraft/server';

// Map menyimpan job aktif. Key: Lokasi Anchor ESS. Value: Instance FreezingManager
const activeRandomTickJobs = new Map();
let randomTickIntervalId = null;

// Kecepatan Loop "Random Tick" simulasi.
// 5 tick = 0.25 detik. Cukup cepat untuk responsif, tapi peluang di freeze_utils yang mengatur lambat/cepatnya.
const TICK_INTERVAL = 5; 

export function registerRandomTickJob(anchorKey, managerInstance) {
    activeRandomTickJobs.set(anchorKey, managerInstance);
    startRandomTickSystem();
}

export function unregisterRandomTickJob(anchorKey) {
    activeRandomTickJobs.delete(anchorKey);
    // Jika kosong, matikan sistem untuk hemat resource
    if (activeRandomTickJobs.size === 0) {
        stopRandomTickSystem();
    }
}

export function cancelJobsAtLocation(location) {
    // Fungsi ini mungkin dipanggil dari luar untuk cleanup
    // Tapi logic baru menggunakan unregisterRandomTickJob via manager
}

function startRandomTickSystem() {
    if (randomTickIntervalId) return;

    randomTickIntervalId = system.runInterval(() => {
        // Iterasi semua job yang terdaftar
        // Kita gunakan Array.from agar aman jika Map dimodifikasi saat iterasi
        for (const [key, manager] of activeRandomTickJobs) {
            try {
                // Panggil executeRandomTick di setiap manager
                // Manager sendiri yang menentukan apakah "berhasil" berdasarkan probabilitas (RNG)
                manager.executeRandomTick();
            } catch (e) {
                console.warn(`Error in random tick job for ${key}: ${e.message}`);
                activeRandomTickJobs.delete(key);
            }
        }
    }, TICK_INTERVAL);
}

function stopRandomTickSystem() {
    if (randomTickIntervalId) {
        system.clearRun(randomTickIntervalId);
        randomTickIntervalId = null;
    }
}