const EventEmitter = require("events");
const config = require("../config");
const waService = require("./whatsapp");

class MessageQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.isProcessing = false;
    this.stats = {
      totalProcessed: 0,
      totalFailed: 0,
    };
  }

  /**
   * Menghasilkan jeda acak (jitter) dalam milidetik
   */
  _getRandomDelay() {
    const min = config.antiBan.minDelayMs || 3000;
    const max = config.antiBan.maxDelayMs || 6000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Helper pause / sleep
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Menambahkan tugas pengiriman pesan ke dalam antrean
   * @param {Object} task
   * @param {string} task.number - Nomor tujuan
   * @param {string} task.message - Isi teks pesan
   * @param {string} [task.sender] - Label pengirim
   * @param {Object} [task.options] - Opsi tambahan (spintax, simulateTyping, dll)
   * @returns {Promise<Object>} Mengembalikan hasil pengiriman pesan
   */
  enqueue(task) {
    return new Promise((resolve, reject) => {
      const queueItem = {
        id: `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        number: task.number,
        message: task.message,
        sender: task.sender || "API",
        options: task.options || {},
        createdAt: new Date(),
        resolve,
        reject,
      };

      this.queue.push(queueItem);
      this.emit("job_enqueued", {
        jobId: queueItem.id,
        queueLength: this.queue.length,
      });

      // Picu proses worker jika belum berjalan
      this._processNext();
    });
  }

  async _processNext() {
    if (this.isProcessing) return;

    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const currentJob = this.queue.shift();

    try {
      console.log(
        `[QUEUE] Memproses job ${currentJob.id} ke ${currentJob.number} (Sisa antrean: ${this.queue.length})`
      );

      const result = await waService.sendTextMessage(
        currentJob.number,
        currentJob.message,
        currentJob.options
      );

      this.stats.totalProcessed++;
      currentJob.resolve(result);
      this.emit("job_completed", { jobId: currentJob.id, result });
    } catch (error) {
      this.stats.totalFailed++;
      console.error(`[QUEUE] Gagal memproses job ${currentJob.id}:`, error.message);
      currentJob.reject(error);
      this.emit("job_failed", { jobId: currentJob.id, error: error.message });
    } finally {
      // Terapkan cooldown / random jitter delay sebelum mengambil pesan berikutnya
      const jitterDelay = this._getRandomDelay();
      console.log(`[QUEUE] Cooldown keamanan anti-ban: ${jitterDelay}ms sebelum pesan berikutnya...`);
      await this._sleep(jitterDelay);

      this.isProcessing = false;
      this._processNext();
    }
  }

  getQueueLength() {
    return this.queue.length;
  }

  getStats() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      ...this.stats,
    };
  }
}

const messageQueue = new MessageQueue();

module.exports = messageQueue;
