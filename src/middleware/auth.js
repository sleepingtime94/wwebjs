const crypto = require("crypto");
const { apiKey } = require("../config");

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function extractApiKey(req) {
  // 1. Header x-api-key (utama, dipakai GemaAntik via proxy PHP)
  const headerKey = req.headers["x-api-key"];
  if (headerKey) return String(headerKey);

  // 2. Header Authorization: Bearer <key>
  const auth = req.headers["authorization"];
  if (auth && typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }

  // API key via query string (?api_key= / ?key=) TIDAK diterima:
  // bocor ke access log/proxy dan riwayat browser.
  return null;
}

function authenticateApiKey(req, res, next) {
  if (!apiKey || apiKey === "your-secret-api-key-here") {
    console.error("[AUTH] API_KEY belum dikonfigurasi di .env — menolak semua request API.");
    return res.status(500).json({
      success: false,
      message: "Server API key belum dikonfigurasi.",
    });
  }

  const requestApiKey = extractApiKey(req);
  if (!requestApiKey || !timingSafeEqual(requestApiKey, apiKey)) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid or missing API key",
    });
  }
  next();
}

module.exports = { authenticateApiKey };
