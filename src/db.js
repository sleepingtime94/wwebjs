const mysql = require("mysql2/promise");
const config = require("./config");

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

async function initDatabase() {
  try {
    // Buat tabel jika belum ada
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS message_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        message_id VARCHAR(255) NULL,
        sender VARCHAR(50) NOT NULL DEFAULT 'API',
        number VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        status ENUM('pending', 'sent', 'delivered', 'read', 'failed') NOT NULL DEFAULT 'sent',
        ack INT DEFAULT 0,
        error_message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_msg_id (message_id)
      )
    `);

    // Pastikan jika tabel lama sudah ada dengan enum lama, kolom status & ack di-update secara aman
    try {
      await pool.execute(`
        ALTER TABLE message_logs 
        MODIFY COLUMN status ENUM('pending', 'sent', 'delivered', 'read', 'failed') NOT NULL DEFAULT 'sent'
      `);
    } catch (_) {}

    try {
      await pool.execute(`
        ALTER TABLE message_logs 
        ADD COLUMN IF NOT EXISTS ack INT DEFAULT 0 AFTER status
      `);
    } catch (_) {}

    console.log("[DB] Database connected & message_logs table ready");

    // Tabel antrean persisten: job selamat dari restart proses.
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS message_jobs (
        id VARCHAR(64) PRIMARY KEY,
        number VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        sender VARCHAR(50) NOT NULL DEFAULT 'API',
        options TEXT NULL,
        status ENUM('queued', 'processing', 'done', 'failed') NOT NULL DEFAULT 'queued',
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 3,
        next_retry_at TIMESTAMP NULL DEFAULT NULL,
        last_error TEXT NULL,
        result_message_id VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_jobs_status (status, next_retry_at)
      )
    `);
    console.log("[DB] message_jobs table ready");
  } catch (err) {
    console.error("[DB] Failed to initialize database:", err.message);
  }
}

async function logMessage({
  messageId = null,
  sender = "API",
  number,
  message = "",
  status = "sent",
  ack = 0,
  errorMessage = null,
}) {
  try {
    const [result] = await pool.execute(
      `INSERT INTO message_logs (message_id, sender, number, message, status, ack, error_message) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [messageId, sender, number, message, status, ack, errorMessage],
    );
    return result.insertId;
  } catch (err) {
    console.error("[DB] Failed to log message:", err.message);
    return null;
  }
}

async function updateMessageStatusByMessageId(messageId, { status, ack, errorMessage = null }) {  if (!messageId) return;
  try {
    const updates = [];
    const params = [];

    if (status) {
      updates.push("status = ?");
      params.push(status);
    }
    if (ack !== undefined && ack !== null) {
      updates.push("ack = ?");
      params.push(ack);
    }
    if (errorMessage !== null) {
      updates.push("error_message = ?");
      params.push(errorMessage);
    }

    if (updates.length === 0) return;

    // Exact match saja: LIKE '%id%' berisiko meng-update baris yang salah
    // dan tidak memakai indeks.
    await pool.execute(`UPDATE message_logs SET ${updates.join(", ")} WHERE message_id = ?`, [
      ...params,
      messageId,
    ]);
  } catch (err) {
    console.error("[DB] Failed to update message status:", err.message);
  }
}

async function createJob({ id, number, message, sender = "API", options = {}, maxAttempts = 3 }) {
  try {
    await pool.execute(
      `INSERT INTO message_jobs (id, number, message, sender, options, status, attempts, max_attempts)
       VALUES (?, ?, ?, ?, ?, 'queued', 0, ?)`,
      [id, number, message, sender, JSON.stringify(options || {}), maxAttempts],
    );
    return true;
  } catch (err) {
    console.error("[DB] Failed to persist job:", err.message);
    return false;
  }
}

async function markJobProcessing(id, attempts) {
  try {
    await pool.execute(
      `UPDATE message_jobs SET status = 'processing', attempts = ?, last_error = NULL WHERE id = ?`,
      [attempts, id],
    );
  } catch (err) {
    console.error("[DB] Failed to mark job processing:", err.message);
  }
}

async function markJobDone(id, resultMessageId) {
  try {
    await pool.execute(
      `UPDATE message_jobs SET status = 'done', result_message_id = ?, last_error = NULL WHERE id = ?`,
      [resultMessageId || null, id],
    );
  } catch (err) {
    console.error("[DB] Failed to mark job done:", err.message);
  }
}

async function markJobRetry(id, nextRetryAt, lastError) {
  try {
    await pool.execute(
      `UPDATE message_jobs SET status = 'queued', next_retry_at = ?, last_error = ? WHERE id = ?`,
      [nextRetryAt, lastError || null, id],
    );
  } catch (err) {
    console.error("[DB] Failed to schedule job retry:", err.message);
  }
}

async function markJobFailed(id, lastError) {
  try {
    await pool.execute(
      `UPDATE message_jobs SET status = 'failed', last_error = ? WHERE id = ?`,
      [lastError || null, id],
    );
  } catch (err) {
    console.error("[DB] Failed to mark job failed:", err.message);
  }
}

async function getPendingJobs(limit = 1000) {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM message_jobs
       WHERE status IN ('queued', 'processing')
       ORDER BY created_at ASC
       LIMIT ${Number(limit) || 1000}`,
    );
    // Job yang mati saat status processing (crash) dianggap queued kembali.
    return (rows || []).map((r) => ({ ...r, status: "queued" }));
  } catch (err) {
    console.error("[DB] Failed to load pending jobs:", err.message);
    return [];
  }
}

module.exports = {
  pool,
  initDatabase,
  logMessage,
  updateMessageStatusByMessageId,
  createJob,
  markJobProcessing,
  markJobDone,
  markJobRetry,
  markJobFailed,
  getPendingJobs,
};
