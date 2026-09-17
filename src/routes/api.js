const express = require("express");
const { authenticateApiKey } = require("../middleware/auth");
const { rateLimiter } = require("../middleware/rateLimiter");
const { getStatus, getQr, logout, sendMessage } = require("../controllers/waController");

const router = express.Router();

// Seluruh endpoint API diproteksi API key via header
// (x-api-key atau Authorization Bearer). Query string tidak diterima.
router.use(authenticateApiKey);

router.get("/status", getStatus);
router.get("/qr", getQr);
router.post("/logout", logout);
router.post("/send-message", rateLimiter, sendMessage);

module.exports = router;
