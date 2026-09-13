require("dotenv").config();

module.exports = {
  port: process.env.PORT || 3000,
  apiKey: process.env.API_KEY || "your-secret-api-key-here",
  mainPage: process.env.APP_MAINPAGE || "https://web.whatsapp.com",
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
  db: {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME || "whatsapp",
  },
};
