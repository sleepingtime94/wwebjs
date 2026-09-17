const waService = require("../services/whatsapp");
const messageQueue = require("../services/messageQueue");
const { logMessage } = require("../db");
const config = require("../config");

async function getStatus(req, res) {
  const state = waService.getState();
  const queueStats = messageQueue.getStats();
  res.json({
    success: true,
    status: state.currentStatus,
    ready: state.clientReady,
    me: waService.getAccountInfo(),
    queue: queueStats,
  });
}

// GET /api/qr — ambil QR code untuk ditautkan via REST (tanpa halaman HTML).
// Query: ?format=json (default, {success, qr dataURL}) | ?format=png (image/png)
async function getQr(req, res) {
  const state = waService.getState();

  if (state.clientReady) {
    return res.status(409).json({
      success: false,
      status: state.currentStatus,
      ready: true,
      message: "WhatsApp sudah terhubung, tidak perlu scan QR.",
    });
  }

  if (state.currentStatus !== "qr" || !state.lastQrDataUrl) {
    return res.status(404).json({
      success: false,
      status: state.currentStatus,
      ready: false,
      message: "QR code belum tersedia. Coba lagi beberapa detik.",
    });
  }

  if ((req.query.format || "json").toLowerCase() === "png") {
    const match = state.lastQrDataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (!match) {
      return res.status(500).json({ success: false, message: "Format QR internal tidak valid." });
    }
    const buffer = Buffer.from(match[1], "base64");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    return res.send(buffer);
  }

  res.setHeader("Cache-Control", "no-store");
  res.json({
    success: true,
    status: state.currentStatus,
    qr: state.lastQrDataUrl,
  });
}

// POST /api/logout — putuskan sesi & minta QR baru (tanpa dashboard HTML).
async function logout(req, res) {
  try {
    await waService.logout();
    const state = waService.getState();
    res.json({
      success: true,
      message: "Berhasil logout. Silakan scan QR baru via GET /api/qr.",
      status: state.currentStatus,
    });
  } catch (error) {
    console.error("[API] Logout error:", error.message);
    res.status(500).json({ success: false, message: "Gagal logout.", error: error.message });
  }
}

async function sendMessage(req, res) {
  const { number, message, sender, spintax, simulateTyping, async: isAsync } = req.body;

  if (!number || !message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({
      success: false,
      message: 'Parameter "number" dan "message" wajib diisi dengan teks yang valid',
    });
  }

  if (message.length > config.messageMaxLength) {
    return res.status(400).json({
      success: false,
      message: `Panjang pesan melebihi batas ${config.messageMaxLength} karakter`,
    });
  }

  const safeSender =
    typeof sender === "string" && sender.length > config.senderMaxLength
      ? sender.slice(0, config.senderMaxLength)
      : sender;

  const options = {
    spintax: spintax !== false,
    simulateTyping: simulateTyping !== false,
  };

  // Mode asynchronous: langsung kembalikan respon bahwa pesan sedang mengantre
  if (isAsync === true) {
    let queuePromise;
    try {
      queuePromise = messageQueue.enqueue({
        number,
        message,
        sender: safeSender,
        options,
      });
    } catch (err) {
      return res.status(err.statusCode || 503).json({
        success: false,
        message: err.message,
      });
    }

    // Tangani proses queue di background
    queuePromise
      .then(async (result) => {
        await logMessage({
          messageId: result.messageId,
          sender: safeSender || result.sender,
          number: result.receiver,
          message: result.message,
          status: "sent",
          ack: 1,
        });
      })
      .catch(async (error) => {
        const formattedNumber = waService.formatNumber(String(number || ""));
        try {
          await logMessage({
            messageId: null,
            sender: safeSender || "API",
            number: formattedNumber || String(number),
            message: String(message || ""),
            status: "failed",
            ack: -1,
            errorMessage: error.message,
          });
        } catch (_) {}
      });

    return res.status(202).json({
      success: true,
      status: "queued",
      message: "Pesan telah dimasukkan ke dalam antrean pengiriman aman",
      queueLength: messageQueue.getQueueLength(),
    });
  }

  // Mode synchronous (default): menunggu antrean memproses dan mengirimkan pesan
  try {
    const result = await messageQueue.enqueue({
      number,
      message,
      sender: safeSender,
      options,
    });

    // Simpan log sukses ke database BESERTA message_id dan initial ack
    const logId = await logMessage({
      messageId: result.messageId,
      sender: safeSender || result.sender,
      number: result.receiver,
      message: result.message,
      status: "sent",
      ack: 1,
    });

    res.json({
      success: true,
      message: "Pesan berhasil dikirim",
      data: {
        id: logId,
        messageId: result.messageId,
        receiver: result.receiver,
        message: result.message,
        originalMessage: result.originalMessage,
        timestamp: result.timestamp,
      },
    });
  } catch (error) {
    console.error("[API] Send message error:", error.message);

    const statusCode = error.statusCode || 500;
    const formattedNumber = waService.formatNumber(String(number || ""));

    // Simpan log gagal ke database
    try {
      await logMessage({
        messageId: null,
        sender: safeSender || "API",
        number: formattedNumber || String(number),
        message: String(message || ""),
        status: "failed",
        ack: -1,
        errorMessage: error.message,
      });
    } catch (logErr) {
      console.error("[DB] Failed to log error:", logErr.message);
    }

    res.status(statusCode).json({
      success: false,
      message: statusCode < 500 ? error.message : "Gagal mengirim pesan",
      error: error.message,
    });
  }
}

module.exports = { getStatus, getQr, logout, sendMessage };
