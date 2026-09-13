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

async function updateMessageStatusByMessageId(messageId, { status, ack, errorMessage = null }) {
  if (!messageId) return;
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

    params.push(messageId, `%${messageId}%`);
    await pool.execute(
      `UPDATE message_logs SET ${updates.join(", ")} WHERE message_id = ? OR message_id LIKE ?`,
      params,
    );
  } catch (err) {
    console.error("[DB] Failed to update message status:", err.message);
  }
}

module.exports = {
  pool,
  initDatabase,
  logMessage,
  updateMessageStatusByMessageId,
};
