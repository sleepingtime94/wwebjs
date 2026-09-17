const express = require("express");
const cors = require("cors");

const config = require("./src/config");
const { initDatabase, pool } = require("./src/db");
const waService = require("./src/services/whatsapp");
const messageQueue = require("./src/services/messageQueue");
const apiRouter = require("./src/routes/api");

const app = express();

// Middleware
const corsOptions = config.corsOrigin
  ? { origin: config.corsOrigin.split(",").map((s) => s.trim()).filter(Boolean) }
  : {};
app.use(cors(corsOptions));
app.use(express.json({ limit: config.jsonLimit }));

// REST API (seluruh endpoint di bawah /api diproteksi API key)
app.use("/api", apiRouter);

// Health check tanpa auth (untuk Docker/K8s & monitoring).
// Selalu 200 selama proses hidup; kondisi komponen ada di body.
app.get("/health", async (req, res) => {
  let dbUp = false;
  try {
    await pool.query("SELECT 1");
    dbUp = true;
  } catch (_) {
    dbUp = false;
  }
  const waState = waService.getState();
  res.json({
    success: true,
    service: "wwebjs-gateway",
    wa: { status: waState.currentStatus, ready: waState.clientReady },
    db: { up: dbUp },
    queue: messageQueue.getStats(),
  });
});

// Root: info service (REST only, tanpa dashboard HTML)
app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "wwebjs-gateway",
    status: waService.getState().currentStatus,
    endpoints: ["GET /api/status", "GET /api/qr", "POST /api/logout", "POST /api/send-message"],
  });
});

// Setup Services
waService.init();

// Server Startup
app.listen(config.port, async () => {
  console.log(`🚀 Server running on port ${config.port}`);
  console.log(`📱 Scan QR code via GET /api/qr (header x-api-key)`);
  await initDatabase();
  await messageQueue.recover();
});

// Process Error Handling
process.on("uncaughtException", (err) => {
  console.error("[PROCESS] Uncaught Exception:", err.message);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error("[PROCESS] Unhandled Rejection:", msg);
});

// Graceful Shutdown
const gracefulShutdown = async () => {
  console.log("[PROCESS] Shutting down gracefully...");
  try {
    await waService.destroy();
    console.log("[WA] Client destroyed properly.");
  } catch (e) {
    console.error("[WA] Error destroying client:", e.message);
  }
  process.exit(0);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
