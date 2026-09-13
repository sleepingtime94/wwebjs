const waService = require("./whatsapp");

let ioInstance = null;

function initSocket(io) {
  ioInstance = io;

  io.on("connection", (socket) => {
    console.log("[SOCKET] Client connected:", socket.id);

    const state = waService.getState();
    socket.emit("status", {
      status: state.currentStatus,
      qr: state.lastQrDataUrl,
    });
  });

  waService.on("status_change", (data) => {
    if (ioInstance) {
      ioInstance.emit("status", data);
    }
  });

  waService.on("message_ack", (data) => {
    if (ioInstance) {
      ioInstance.emit("message_ack", data);
    }
  });
}

function broadcastMessageSent(payload) {
  if (ioInstance) {
    ioInstance.emit("message_sent", payload);
  }
}

module.exports = { initSocket, broadcastMessageSent };
