const path = require("path");
const waService = require("../services/whatsapp");
const messageQueue = require("../services/messageQueue");
const { broadcastMessageSent } = require("../services/socket");
const { logMessage } = require("../db");

async function renderConnectPage(req, res) {
  res.sendFile(path.join(__dirname, "../../public/index.html"));
}

async function getStatus(req, res) {
  const state = waService.getState();
  const queueStats = messageQueue.getStats();
  res.json({
    success: true,
    status: state.currentStatus,
    ready: state.clientReady,
    queue: queueStats,
  });
}

async function sendMessage(req, res) {
  const { number, message, sender, spintax, simulateTyping, async: isAsync } = req.body;

  if (!number || !message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({
      success: false,
      message: 'Parameter "number" dan "message" wajib diisi dengan teks yang valid',
    });
  }

  const options = {
    spintax: spintax !== false,
    simulateTyping: simulateTyping !== false,
  };

  // Mode asynchronous: langsung kembalikan respon bahwa pesan sedang mengantre
  if (isAsync === true) {
    const queuePromise = messageQueue.enqueue({
      number,
      message,
      sender,
      options,
    });

    // Tangani proses queue di background
    queuePromise
      .then(async (result) => {
        const logId = await logMessage({
          messageId: result.messageId,
          sender: sender || result.sender,
          number: result.receiver,
          message: result.message,
          status: "sent",
          ack: 1,
        });

        broadcastMessageSent({
          messageId: result.messageId,
          receiver: result.receiver,
          timestamp: new Date().toISOString(),
        });
      })
      .catch(async (error) => {
        const formattedNumber = waService.formatNumber(String(number || ""));
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
      sender,
      options,
    });

    // Simpan log sukses ke database BESERTA message_id dan initial ack
    const logId = await logMessage({
      messageId: result.messageId,
      sender: sender || result.sender,
      number: result.receiver,
      message: result.message,
      status: "sent",
      ack: 1,
    });

    // Broadcast status ke dashboard via socket
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
