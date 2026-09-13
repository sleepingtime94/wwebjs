@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo   WhatsApp Gateway - Windows Deployment Script
echo ===================================================

:: 1. Validasi file .env
if not exist ".env" (
    echo [ERROR] File .env tidak ditemukan!
    echo Silakan salin file .env.example menjadi .env terlebih dahulu:
    echo copy .env.example .env
    exit /b 1
)

:: 2. Pull repository terbaru jika direktori .git ada
if exist ".git" (
    echo [DEPLOY] Menarik perubahan terbaru dari Git...
    call git pull origin main
)

:: 3. Memastikan direktori logs tersedia
echo [DEPLOY] Memastikan folder logs tersedia...
if not exist "logs" mkdir logs

:: 4. Menginstal dependensi produksi
echo [DEPLOY] Menginstal dependensi npm (production)...
call npm install --omit=dev
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Gagal menginstal dependensi NPM!
    exit /b %ERRORLEVEL%
)

:: 5. Restart atau Start PM2
echo [DEPLOY] Memperbarui proses di PM2...
call pm2 describe wa-gateway >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [DEPLOY] Merestart instance wa-gateway yang sudah berjalan...
    call pm2 restart wa-gateway --update-env
) else (
    echo [DEPLOY] Menjalankan instance baru via ecosystem.config.js...
    call pm2 start ecosystem.config.js
)

:: 6. Simpan state PM2
call pm2 save

echo ===================================================
echo [DEPLOY] Deployment selesai!
echo ===================================================
call pm2 logs wa-gateway --lines 20 --nostream

endlocal
