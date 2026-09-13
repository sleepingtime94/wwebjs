const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { updateMessageStatusByMessageId } = require("../db");

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.isReconnecting = false;
    this.reconnectTimer = null;
    this.state = {
      clientReady: false,
      currentStatus: "initializing",
      lastQrDataUrl: null,
    };
  }

  _cleanupSessionLocks() {
    try {
      const sessionPath = path.join(process.cwd(), ".wwebjs_auth", "session");
      if (fs.existsSync(sessionPath)) {
        const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket", "parent.lock"];
        for (const file of lockFiles) {
          const filePath = path.join(sessionPath, file);
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
              console.log(`[WA] Cleaned up stale lock file: ${file}`);
            } catch (e) {
              console.warn(`[WA] Non-fatal: could not remove ${file}:`, e.message);
            }
          }
        }
      }
    } catch (err) {
      console.warn("[WA] Lock cleanup check warning:", err.message);
    }
  }

  init() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const isLinux = process.platform === "linux";

    // Bersihkan file lock sisa proses Chromium sebelumnya
    this._cleanupSessionLocks();

    // Args optimal untuk Windows dan Linux (headless server)
    const chromeArgs = [
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--disable-gpu",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-extensions",
      "--disable-default-apps",
    ];

    if (isLinux) {
      chromeArgs.push("--no-sandbox", "--disable-setuid-sandbox", "--no-zygote");
    }

    const puppeteerConfig = {
      headless: true,
      args: chromeArgs,
    };

    if (config.puppeteerExecutablePath) {
      puppeteerConfig.executablePath = config.puppeteerExecutablePath;
      console.log(`[WA] Using custom Chromium: ${config.puppeteerExecutablePath}`);
    }

    console.log(`[WA] Platform: ${process.platform} | Headless: true`);

    this.client = new Client({
      authStrategy: new LocalAuth(),
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      puppeteer: puppeteerConfig,
      webVersionCache: {
        type: "remote",
        remotePath:
          "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html",
        strict: false,
      },
    });

    this._setupLogoutOverride();
    this._registerEvents();

    this.client.initialize().catch((err) => {
      console.error("[WA] Client initialization error:", err.message);
      this._updateStatus("disconnected", { reason: err.message });
    });

    return this.client;
  }

  _setupLogoutOverride() {
    const originalLogout = this.client.authStrategy.logout.bind(this.client.authStrategy);
    this.client.authStrategy.logout = async () => {
      try {
        if (this.client.pupBrowser && this.client.pupBrowser.isConnected()) {
          await this.client.pupBrowser.close();
          console.log("[Auth] Browser closed to release file locks.");
        }
      } catch (e) {
        console.log("[Auth] Browser close warning:", e.message);
      }

      await new Promise((r) => setTimeout(r, 2000));

      try {
        await originalLogout();
        console.log("[Auth] Session directory cleared.");
      } catch (e) {
        console.log("[Auth] Standard logout failed, forcing session removal:", e.message);
        const sessionDir = this.client.authStrategy.userDataDir;
        if (sessionDir) {
          try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log("[Auth] Session directory force-removed.");
          } catch (err) {
            console.warn("[Auth] Could not remove session dir (non-fatal):", err.message);
          }
        }
      }
    };
  }

  _updateStatus(status, data = {}) {
    this.state.currentStatus = status;
    this.emit("status_change", { status, ...data });
    console.log(`[STATUS] ${status}`);
  }

  _registerEvents() {
    this.client.on("loading_screen", (percent, message) => {
      console.log(`[WA] Loading: ${percent}% - ${message}`);
      this._updateStatus("loading", { percent, message });
    });

    this.client.on("qr", async (qr) => {
      console.log("[WA] QR Code received from WhatsApp Web. Generating image...");
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          width: 300,
          margin: 2,
          color: { dark: "#010101ff", light: "#FFFFFF" },
        });
        this.state.lastQrDataUrl = qrDataUrl;
        this.state.clientReady = false;
        this._updateStatus("qr", { qr: qrDataUrl });
        console.log("[WA] QR Code ready to scan via /api/connect");
      } catch (err) {
        console.error("[QR] Error generating QR Data URL:", err);
      }
    });

    this.client.on("authenticated", () => {
      this.state.lastQrDataUrl = null;
      this._updateStatus("authenticated");
      console.log("[WA] Authenticated successfully!");
    });

    this.client.on("auth_failure", (msg) => {
      this.state.clientReady = false;
      this.state.lastQrDataUrl = null;
      this._updateStatus("auth_failure", { message: msg });
      console.error("[AUTH] Authentication failure:", msg);
    });

    this.client.on("ready", () => {
      this.state.clientReady = true;
      this.state.lastQrDataUrl = null;
      this._updateStatus("ready");
      console.log("[WA] Client is ready & synchronized!");
    });

    // Update status pesan di DB berdasarkan ACK dari server WhatsApp
    this.client.on("message_ack", async (msg, ack) => {
      const rawId = msg?.id;
      let messageId = null;
      if (rawId) {
        messageId = rawId._serialized || rawId.id || (typeof rawId === "string" ? rawId : null);
      }
      if (!messageId) return;

      const statusMap = { "-1": "failed", 0: "pending", 1: "sent", 2: "delivered", 3: "read", 4: "read" };
      const status = statusMap[ack] ?? "sent";
      const errorMessage = ack === -1 ? "Gagal terkirim ke server WhatsApp (ACK_ERROR)" : null;

      console.log(`[WA:ACK] ${messageId} → ack ${ack} (${status})`);
      await updateMessageStatusByMessageId(messageId, { status, ack, errorMessage });
      this.emit("message_ack", { messageId, status, ack });
    });

    this.client.on("disconnected", async (reason) => {
      this.state.clientReady = false;
      this.state.lastQrDataUrl = null;
      this._updateStatus("disconnected", { reason });
      console.log("[WA] Disconnected:", reason);

      this.reconnect(reason === "LOGOUT" ? 4000 : 5000);
    });
  }

  reconnect(delayMs = 5000) {
    if (this.isReconnecting) {
      console.log("[WA] Reconnect already in progress, skipping duplicate call.");
      return;
    }
    this.isReconnecting = true;
    this._updateStatus("reconnecting");

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      console.log("[WA] Cleaning up previous client before reinitializing...");
      try {
        await this.destroy();
      } catch (err) {
        console.warn("[WA] Error destroying client during reconnect:", err.message);
      }

      this._updateStatus("initializing");
      try {
        this.init();
      } catch (err) {
        console.error("[WA] Reinitialization failed:", err.message);
      } finally {
        this.isReconnecting = false;
        this.reconnectTimer = null;
      }
    }, delayMs);
  }

  formatNumber(number) {
    if (!number) return "";
    let str = String(number).trim();

    // Jika pesan ditujukan untuk grup WhatsApp (@g.us)
    if (str.endsWith("@g.us")) {
      return str;
    }

    // Bersihkan karakter selain angka
    let formatted = str.replace(/\D/g, "");

    // Tangani kemungkinan typo 6208xxx -> 628xxx
    if (formatted.startsWith("6208")) {
      formatted = "628" + formatted.slice(4);
    } else if (formatted.startsWith("0")) {
      formatted = "62" + formatted.slice(1);
    } else if (formatted.startsWith("8")) {
      formatted = "62" + formatted;
    }

    return formatted;
  }

  async sendTextMessage(number, message) {
    if (!this.state.clientReady || !this.client) {
      const error = new Error("WhatsApp client belum siap. Silakan scan QR code terlebih dahulu.");
      error.statusCode = 503;
      throw error;
    }

    const formattedNumber = this.formatNumber(number);
    if (!formattedNumber.endsWith("@g.us") && formattedNumber.length < 9) {
      const error = new Error(`Format nomor tidak valid: ${number}`);
      error.statusCode = 400;
      throw error;
    }

    let chatId;
    if (formattedNumber.endsWith("@g.us")) {
      chatId = formattedNumber;
    } else {
      // Cek apakah nomor terdaftar di WhatsApp
      const numberId = await this.client.getNumberId(formattedNumber);
      if (!numberId) {
        const error = new Error(`Nomor ${formattedNumber} tidak terdaftar di WhatsApp.`);
        error.statusCode = 404;
        throw error;
      }
      chatId = numberId._serialized;
    }

    console.log(`[WA] Mengirim pesan ke: ${chatId}`);

    // Kirim pesan dan tangkap objek Message
    const sentMessage = await this.client.sendMessage(chatId, message);
    const messageId = sentMessage?.id?._serialized || sentMessage?.id?.id || null;

    return {
      messageId,
      sender: this.client.info?.wid?.user ?? "API",
      receiver: formattedNumber,
      chatId,
      message,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  getState() {
    return { ...this.state };
  }

  async destroy() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      try {
        this.client.removeAllListeners();
        if (this.client.pupBrowser && this.client.pupBrowser.isConnected()) {
          await this.client.pupBrowser.close();
        }
        await this.client.destroy();
      } catch (_) {}
      this.client = null;
    }
    this._cleanupSessionLocks();
  }
}

const waService = new WhatsAppService();

module.exports = waService;
