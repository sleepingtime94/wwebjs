module.exports = {
  apps: [
    {
      name: "wa-gateway",
      script: "server.js",
      instances: 1,          // HARUS 1 — session WhatsApp tidak bisa paralel
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      merge_logs: true,
    },
  ],
};
