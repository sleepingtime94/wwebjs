const { apiKey } = require("../config");

function authenticateApiKey(req, res, next) {
  const requestApiKey = req.headers["x-api-key"];
  if (!requestApiKey || requestApiKey !== apiKey) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid or missing API key",
    });
  }
  next();
}

module.exports = { authenticateApiKey };
