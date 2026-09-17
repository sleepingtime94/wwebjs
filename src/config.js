require("dotenv").config();

module.exports = {
  port: process.env.PORT || 3000,
  apiKey: process.env.API_KEY || "your-secret-api-key-here",
  corsOrigin: process.env.CORS_ORIGIN || "",
  jsonLimit: process.env.JSON_LIMIT || "100kb",
  messageMaxLength: Number(process.env.MESSAGE_MAX_LENGTH) || 4096,
  senderMaxLength: Number(process.env.SENDER_MAX_LENGTH) || 50,
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "whatsapp",
  },
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 30,
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  queueMaxLength: Number(process.env.QUEUE_MAX_LENGTH) || 500,
  jobMaxAttempts: Number(process.env.JOB_MAX_ATTEMPTS) || 3,
  jobRetryBaseDelayMs: Number(process.env.JOB_RETRY_BASE_DELAY_MS) || 10000,
  waSendTimeoutMs: Number(process.env.WA_SEND_TIMEOUT_MS) || 30000,
  antiBan: {
    minDelayMs: Number(process.env.ANTI_BAN_MIN_DELAY_MS) || 3000,
    maxDelayMs: Number(process.env.ANTI_BAN_MAX_DELAY_MS) || 6000,
    simulateTyping: process.env.ANTI_BAN_SIMULATE_TYPING !== "false",
    enableSpintax: process.env.ANTI_BAN_ENABLE_SPINTAX !== "false",
  },
};
