const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { updateMessageStatusByMessageId } = require("../db");
const { parseSpintax } = require("../utils/spintax");

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

  _getSystemChromeCandidates() {
    const candidates = [];
    if (process.platform === "win32") {
      const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
      const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
      const localAppData = process.env.LOCALAPPDATA || "";
      candidates.push(
        path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programFiles, "Chromium", "Application", "chrome.exe"),
        path.join(programFilesX86, "Chromium", "Application", "chrome.exe"),
        path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe")
      );
      if (localAppData) {
        candidates.push(
          path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
          path.join(localAppData, "Chromium", "Application", "chrome.exe")
        );
      }
    } else if (process.platform === "darwin") {
      candidates.push(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      );
    } else {
      // Linux / lainnya
      candidates.push(
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/snap/bin/chromium",
        "/usr/bin/chrome",
        "/opt/google/chrome/chrome"
      );
    }
    return candidates;
  }

  _resolveChromiumExecutable() {
    // 1. Prioritas: PUPPETEER_EXECUTABLE_PATH dari .env (jika file-nya benar-benar ada)
    const customPath = (config.puppeteerExecutablePath || "").trim();
    if (customPath) {
      if (fs.existsSync(customPath)) {
        return { path: customPath, source: "PUPPETEER_EXECUTABLE_PATH (.env)" };
      }
      console.warn(`[WA] PUPPETEER_EXECUTABLE_PATH tidak ditemukan: ${customPath} (diabaikan, lanjut auto-detect)`);
    }

    // 2. Cache bawaan Puppeteer (whatsapp-web.js -> puppeteer)
    try {
      const puppeteer = require("puppeteer");
      const cached = puppeteer.executablePath();
      if (cached && fs.existsSync(cached)) {
        return { path: cached, source: "cache bawaan Puppeteer" };
      }
      if (cached) {
        console.warn(`[WA] Cache Puppeteer belum terunduh: ${cached}`);
      }
    } catch (e) {
      console.warn("[WA] Tidak bisa membaca puppeteer.executablePath():", e.message);
    }

    // 3. Fallback: Chrome/Chromium yang terinstal di sistem (kasus error "Chrome not found")
    for (const candidate of this._getSystemChromeCandidates()) {
      try {
        if (candidate && fs.existsSync(candidate)) {
          return { path: candidate, source: "Chrome sistem (auto-detect)" };
        }
      } catch (_) {}
    }

    return null;
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
      "--disable-blink-features=AutomationControlled",
      // Flag optimasi memori & resource Chromium:
      "--disable-background-networking",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-default-browser-check",
      "--safebrowsing-disable-auto-update",
      "--renderer-process-limit=2",
      "--js-flags=--max-old-space-size=512",
    ];

    if (isLinux) {
      chromeArgs.push("--no-sandbox", "--disable-setuid-sandbox", "--no-zygote");
    }

    const puppeteerConfig = {
      headless: true,
      args: chromeArgs,
    };

    // Auto-detect Chromium executable (perbaikan error "Chrome not found"):
    // .env -> cache Puppeteer -> Chrome/Chromium sistem
    const resolved = this._resolveChromiumExecutable();
    if (resolved) {
      puppeteerConfig.executablePath = resolved.path;
      console.log(`[WA] Menggunakan Chromium (${resolved.source}): ${resolved.path}`);
    } else {
      console.error(
        "[WA] Chromium/Chrome tidak ditemukan! Solusi:\n" +
          "  1) Jalankan: npx puppeteer browsers install chrome\n" +
          "  2) ATAU install Chrome/Chromium sistem, ATAU\n" +
          "  3) Set PUPPETEER_EXECUTABLE_PATH di .env ke path chrome.exe/chromium yang valid"
      );
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
    this._setupBrowserHooks();
    this._registerEvents();

    this.client.initialize().catch((err) => {
      const msg = err?.message || String(err);
      console.error("[WA] Client initialization error:", msg);
      if (/could not find chrome|chrome not found|failed to launch/i.test(msg)) {
        console.error(
          "[WA] Perbaikan: jalankan 'npx puppeteer browsers install chrome' " +
            "atau set PUPPETEER_EXECUTABLE_PATH di .env ke Chrome sistem."
        );
      }
      this._updateStatus("disconnected", { reason: msg });
    });

    return this.client;
  }

  _setupBrowserHooks() {
    const originalAfterBrowserInit = this.client.authStrategy.afterBrowserInitialized.bind(
      this.client.authStrategy
    );
    this.client.authStrategy.afterBrowserInitialized = async () => {
      await originalAfterBrowserInit();
      if (this.client.pupPage) {
        await this._setupResourceBlocking(this.client.pupPage);
      }
    };
  }

  async _setupResourceBlocking(page) {
    if (!page) return;
    try {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        const url = req.url();

        // 1. Blokir media berat: video dan audio (status, voice notes, video streams)
        if (resourceType === "media") {
          return req.abort();
        }

        // 2. Blokir font eksternal non-esensial (hemat font cache buffer)
        if (resourceType === "font") {
          return req.abort();
        }

        // 3. Blokir tracker / telemetri analitik
        if (
          url.includes("google-analytics") ||
          url.includes("doubleclick") ||
          url.includes("crashlytics")
        ) {
          return req.abort();
        }

        req.continue();
      });
      console.log("[WA:Memory] Resource blocking aktif (media, font eksternal, tracker diblokir).");
    } catch (err) {
      console.warn("[WA:Memory] Gagal mengaktifkan resource blocking:", err.message);
    }
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
        console.log("[WA] QR Code ready to scan via GET /api/qr");
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

  formatNumber(number) {    if (!number) return "";
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

  // Menjalankan promise dengan batas waktu agar satu panggilan WA yang
  // macet tidak menahan seluruh antrean selamanya.
  _withTimeout(promise, ms, label) {
    const timeoutMs = ms || config.waSendTimeoutMs || 30000;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Timeout ${label} setelah ${timeoutMs}ms.`);
        error.statusCode = 503;
        reject(error);
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async sendTextMessage(number, message, options = {}) {
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
      const numberId = await this._withTimeout(
        this.client.getNumberId(formattedNumber),
        null,
        "cek nomor WhatsApp"
      );
      if (!numberId) {
        const error = new Error(`Nomor ${formattedNumber} tidak terdaftar di WhatsApp.`);
        error.statusCode = 404;
        throw error;
      }
      chatId = numberId._serialized;
    }

    // 1. Spintax parsing jika diaktifkan
    let finalMessage = message;
    if (config.antiBan?.enableSpintax && options.spintax !== false) {
      finalMessage = parseSpintax(message);
    }

    // 2. Simulasi perilaku manusia (Presence, Seen, Typing Indicator)
    if (config.antiBan?.simulateTyping && options.simulateTyping !== false) {
      try {
        await this.client.sendPresenceAvailable().catch(() => {});
        const chat = await this._withTimeout(
          this.client.getChatById(chatId).catch(() => null),
          10000,
          "ambil chat"
        ).catch(() => null);
        if (chat) {
          // Tandai chat telah dilihat (seen)
          await chat.sendSeen().catch(() => {});

          // Durasi simulasi mengetik realistis (1.5s - 4.5s tergantung panjang pesan)
          const typingDuration = Math.min(
            4500,
            Math.max(1500, finalMessage.length * 30 + Math.floor(Math.random() * 600))
          );

          await chat.sendStateTyping().catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, typingDuration));
          await chat.clearState().catch(() => {});
        }
      } catch (presenceErr) {
        console.warn("[WA] Warning simulasi kehadiran (presence):", presenceErr.message || presenceErr);
      }
    }

    console.log(`[WA] Mengirim pesan ke: ${chatId}`);

    // 3. Kirim pesan dan tangkap objek Message
    const sentMessage = await this._withTimeout(
      this.client.sendMessage(chatId, finalMessage),
      null,
      "kirim pesan"
    );
    const messageId =
      sentMessage?.id?._serialized ||
      sentMessage?.id?.id ||
      (typeof sentMessage?.id === "string" ? sentMessage.id : null) ||
      sentMessage?._data?.id?._serialized ||
      sentMessage?._data?.id?.id ||
      null;

    return {
      messageId,
      sender: this.client.info?.wid?.user ?? "API",
      receiver: formattedNumber,
      chatId,
      message: finalMessage,
      originalMessage: message,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  getState() {
    return { ...this.state };
  }

  // Info akun yang terhubung (null bila belum ready).
  getAccountInfo() {
    try {
      if (!this.state.clientReady || !this.client || !this.client.info) return null;
      const info = this.client.info;
      return {
        phone: info?.wid?.user ?? null,
        name: info?.pushname ?? null,
        platform: info?.platform ?? null,
      };
    } catch (_) {
      return null;
    }
  }

  // Keluar dari sesi terhubung: membersihkan session .wwebjs_auth lalu
  // memicu re-inisialisasi otomatis (event "disconnected" LOGOUT -> reconnect),
  // sehingga QR baru diterbitkan via GET /api/qr.
  async logout() {
    this.state.lastQrDataUrl = null;
    if (!this.client) {
      this._updateStatus("initializing");
      this.init();
      return;
    }
    try {
      await this.client.logout();
    } catch (err) {
      console.warn("[WA] Logout gagal, paksa destroy + re-init:", err.message);
      try {
        await this.destroy();
      } catch (_) {}
      this._updateStatus("initializing");
      this.init();
    }
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
