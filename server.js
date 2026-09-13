const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");

const config = require("./src/config");
const { initDatabase } = require("./src/db");
const waService = require("./src/services/whatsapp");
const { initSocket } = require("./src/services/socket");
const apiRouter = require("./src/routes/api");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(cors());
app.use(express.json());

// Static Files & Dashboard
app.use("/api", express.static(path.join(__dirname, "public")));
app.use("/api", apiRouter);

// Root redirect
app.get("/", (req, res) => {
  res.redirect(301, config.mainPage);
});

// Setup Services
initSocket(io);
waService.init();

// Server Startup
server.listen(config.port, async () => {
  console.log(`🚀 Server running on port ${config.port}`);
  console.log(`📱 Scan QR code via /api/connect`);
  await initDatabase();
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
