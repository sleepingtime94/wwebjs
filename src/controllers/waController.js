const path = require("path");
const waService = require("../services/whatsapp");
const { broadcastMessageSent } = require("../services/socket");
const { logMessage } = require("../db");

async function renderConnectPage(req, res) {
  res.sendFile(path.join(__dirname, "../../public/index.html"));
}

async function getStatus(req, res) {
  const state = waService.getState();
  res.json({
    success: true,
    status: state.currentStatus,
    ready: state.clientReady,
  });
}

async function sendMessage(req, res) {
  const { number, message, sender } = req.body;

  if (!number || !message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({
      success: false,
      message: 'Parameter "number" dan "message" wajib diisi dengan teks yang valid',
    });
  }

  try {
    const result = await waService.sendTextMessage(number, message);

    // Simpan log sukses ke database BESERTA message_id dan initial ack
    const logId = await logMessage({
      messageId: result.messageId,
      sender: sender || result.sender,
      number: result.receiver,
      message,
      status: "sent",
      ack: 1,
    });

    // Broadcast status ke dashboard via socket (tanpa membocorkan isi teks pesan)
    broadcastMessageSent({
      messageId: result.messageId,
      receiver: result.receiver,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: "Pesan berhasil dikirim",
      data: {
        id: logId,
        messageId: result.messageId,
        receiver: result.receiver,
        message,
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
        sender: sender || "API",
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

module.exports = { renderConnectPage, getStatus, sendMessage };
