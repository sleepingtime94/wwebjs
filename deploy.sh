#!/bin/bash
# Script deployment untuk Linux Server (Ubuntu/Debian)
# Penggunaan: chmod +x deploy.sh && ./deploy.sh

set -e

echo "==================================================="
echo "  WhatsApp Gateway - Linux Deployment Script"
echo "==================================================="

# 1. Validasi file .env
if [ ! -f .env ]; then
  echo "❌ [ERROR] File .env tidak ditemukan!"
  echo "👉 Silakan salin .env.example ke .env dan sesuaikan konfigurasinya terlebih dahulu:"
  echo "   cp .env.example .env"
  exit 1
fi

# 2. Pull repository terbaru jika direktori .git tersedia
if [ -d .git ]; then
  echo "📦 [GIT] Menarik perubahan terbaru dari Git..."
  git pull origin main || echo "⚠️ [GIT] Warning: Git pull gagal atau terdapat konflik lokal."
fi

# 3. Memastikan direktori logs tersedia
echo "📁 [FS] Memastikan folder logs tersedia..."
mkdir -p logs

# 4. Menginstal dependensi produksi
echo "📦 [NPM] Menginstal dependensi npm (production)..."
npm install --omit=dev

# 5. Restart atau Start PM2
echo "🔄 [PM2] Memperbarui proses di PM2..."
if pm2 describe wa-gateway > /dev/null 2>&1; then
  echo "🔄 [PM2] Merestart instance wa-gateway yang sudah berjalan..."
  pm2 restart wa-gateway --update-env
else
  echo "🚀 [PM2] Menjalankan instance baru via ecosystem.config.js..."
  pm2 start ecosystem.config.js
fi

# 6. Simpan konfigurasi PM2 agar bertahan setelah server reboot
pm2 save

echo "==================================================="
echo "✅ [DEPLOY] Deployment selesai!"
echo "==================================================="
pm2 logs wa-gateway --lines 20 --nostream
