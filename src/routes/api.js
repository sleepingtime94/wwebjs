const express = require("express");
const { authenticateApiKey } = require("../middleware/auth");
const {
  renderConnectPage,
  getStatus,
  sendMessage,
} = require("../controllers/waController");

const router = express.Router();

router.get("/connect", renderConnectPage);
router.get("/status", getStatus);
router.post("/send-message", authenticateApiKey, sendMessage);

module.exports = router;
