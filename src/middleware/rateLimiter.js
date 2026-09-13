const config = require("../config");

// In-memory store untuk pelacakan request window
const requestCounts = new Map();

// Pembersihan berkala setiap 5 menit untuk mencegah memory leak
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of requestCounts.entries()) {
    if (now - record.startTime > (config.rateLimitWindowMs || 60000)) {
      requestCounts.delete(key);
    }
  }
}, 5 * 60 * 1000);
cleanupInterval.unref();

/**
 * Middleware Rate Limiter berbasis Sliding/Fixed Window sederhana
 */
function rateLimiter(req, res, next) {
  const windowMs = config.rateLimitWindowMs || 60 * 1000; // default 1 menit
  const maxRequests = config.rateLimitMax || 30; // default max 30 request per menit

  const clientIdentifier =
    req.headers["x-api-key"] ||
    req.ip ||
    req.connection.remoteAddress ||
    "global";

  const now = Date.now();
  let record = requestCounts.get(clientIdentifier);

  if (!record || now - record.startTime > windowMs) {
    record = {
      startTime: now,
      count: 1,
    };
    requestCounts.set(clientIdentifier, record);
    return next();
  }

  record.count += 1;

  if (record.count > maxRequests) {
    const retryAfter = Math.ceil((record.startTime + windowMs - now) / 1000);
    return res.status(429).json({
      success: false,
      message: `Terlalu banyak permintaan (Rate limit tercapai). Maksimal ${maxRequests} pesan per menit. Coba lagi dalam ${retryAfter} detik.`,
      retryAfter,
    });
  }

  next();
}

module.exports = { rateLimiter };
