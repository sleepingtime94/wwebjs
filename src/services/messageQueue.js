const EventEmitter = require("events");
const config = require("../config");
const waService = require("./whatsapp");
const {
  createJob,
  markJobProcessing,
  markJobDone,
  markJobRetry,
  markJobFailed,
  getPendingJobs,
} = require("../db");

function formatRetryDelay(attempts) {
  const base = config.jobRetryBaseDelayMs || 10000;
  return Math.min(base * Math.max(1, attempts), 5 * 60 * 1000);
}

function toMysqlDatetime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

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
   * Menambahkan tugas pengiriman pesan ke dalam antrean persisten.
   * Melempar error 429 jika antrean penuh, 503 jika DB tidak bisa ditulisi?
   * Tidak: persist best-effort — job tetap diproses in-memory walau DB down.
   * @returns {Promise<Object>} Mengembalikan hasil pengiriman pesan
   */
  enqueue(task) {
    const maxLength = config.queueMaxLength ?? 500;
    if (this.queue.length >= maxLength) {
      const error = new Error(
        `Antrean penuh (${this.queue.length}/${maxLength}). Coba lagi nanti.`
      );
      error.statusCode = 429;
      throw error;
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const maxAttempts = config.jobMaxAttempts || 3;

    // Persist best-effort (jangan gagalkan request bila DB down).
    createJob({
      id: jobId,
      number: task.number,
      message: task.message,
      sender: task.sender || "API",
      options: task.options || {},
      maxAttempts,
    }).catch(() => {});

    return new Promise((resolve, reject) => {
      const queueItem = {
        id: jobId,
        number: task.number,
        message: task.message,
        sender: task.sender || "API",
        options: task.options || {},
        attempts: 0,
        maxAttempts,
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

  /**
   * Memulihkan job yang belum selesai dari DB setelah restart proses.
   * Dipanggil sekali saat boot (server.js) setelah initDatabase().
   */
  async recover() {
    try {
      const rows = await getPendingJobs(1000);
      if (!rows.length) return;
      for (const row of rows) {
        let options = {};
        try {
          options = row.options ? JSON.parse(row.options) : {};
        } catch (_) {
          options = {};
        }
        this.queue.push({
          id: row.id,
          number: row.number,
          message: row.message,
          sender: row.sender || "API",
          options,
          attempts: Number(row.attempts) || 0,
          maxAttempts: Number(row.max_attempts) || config.jobMaxAttempts || 3,
          createdAt: row.created_at ? new Date(row.created_at) : new Date(),
          resolve: null,
          reject: null,
          recovered: true,
        });
      }
      console.log(`[QUEUE] Recovered ${rows.length} pending job(s) dari database.`);
      this._processNext();
    } catch (err) {
      console.error("[QUEUE] Recover gagal:", err.message);
    }
  }

  async _processNext() {
    if (this.isProcessing) return;

    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const currentJob = this.queue.shift();
    currentJob.attempts += 1;

    try {
      console.log(
        `[QUEUE] Memproses job ${currentJob.id} ke ${currentJob.number} ` +
          `(upaya ${currentJob.attempts}/${currentJob.maxAttempts}, sisa antrean: ${this.queue.length})`
      );

      await markJobProcessing(currentJob.id, currentJob.attempts);

      const result = await waService.sendTextMessage(
        currentJob.number,
        currentJob.message,
        currentJob.options
      );

      await markJobDone(currentJob.id, result.messageId);
      this.stats.totalProcessed++;
      if (currentJob.resolve) currentJob.resolve(result);
      this.emit("job_completed", { jobId: currentJob.id, result });

      // Cooldown anti-ban hanya setelah sukses.
      const jitterDelay = this._getRandomDelay();
      console.log(`[QUEUE] Cooldown keamanan anti-ban: ${jitterDelay}ms sebelum pesan berikutnya...`);
      await this._sleep(jitterDelay);
    } catch (error) {
      console.error(`[QUEUE] Gagal memproses job ${currentJob.id}:`, error.message);

      if (currentJob.attempts < currentJob.maxAttempts) {
        const delay = formatRetryDelay(currentJob.attempts);
        const nextRetry = toMysqlDatetime(new Date(Date.now() + delay));
        await markJobRetry(currentJob.id, nextRetry, error.message);
        console.log(`[QUEUE] Job ${currentJob.id} dijadwalkan ulang dalam ${delay}ms.`);
        setTimeout(() => {
          this.queue.push(currentJob);
          this._processNext();
        }, delay);
        // Lanjut ke job berikutnya tanpa cooldown penuh.
        this.isProcessing = false;
        this._processNext();
        return;
      }

      await markJobFailed(currentJob.id, error.message);
      this.stats.totalFailed++;
      if (currentJob.reject) {
        currentJob.reject(error);
      } else if (currentJob.recovered) {
        // Job hasil recover tidak punya promise menunggu — cukup catat.
        this.emit("job_failed", { jobId: currentJob.id, error: error.message });
      } else {
        this.emit("job_failed", { jobId: currentJob.id, error: error.message });
      }
    } finally {
      if (this.isProcessing) {
        this.isProcessing = false;
        this._processNext();
      }
    }
  }

  getQueueLength() {
    return this.queue.length;
  }

  getStats() {
    return {
      queueLength: this.queue.length,
      // Alias untuk kompatibilitas konsumen lama (membaca queue.length).
      length: this.queue.length,
      isProcessing: this.isProcessing,
      ...this.stats,
    };
  }
}

const messageQueue = new MessageQueue();

module.exports = messageQueue;
