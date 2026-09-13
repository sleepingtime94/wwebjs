# WhatsApp Gateway API (wwebjs-gateway)

Gateway API berbasis Node.js untuk mengirim dan memantau pesan WhatsApp menggunakan library [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), Express, Socket.IO, dan MySQL untuk pencatatan log pesan.

---

> ### ⚠️ PENTING: DISCLAIMER (HANYA UNTUK PEMBELAJARAN)
>
> Proyek ini dibuat **semata-mata untuk tujuan edukasi, penelitian, dan pembelajaran** mengenai interaksi headless browser (Puppeteer) dan arsitektur REST API + WebSocket di Node.js.
>
> - Proyek ini **BUKAN** produk resmi dan **TIDAK** berafiliasi, didukung, atau terkait dengan WhatsApp Inc. atau Meta Platforms, Inc.
> - WhatsApp melarang penggunaan bot atau otomatisasi tanpa otorisasi resmi melalui WhatsApp Business Cloud API. Penggunaan script/alat otomatisasi pihak ketiga berisiko menyebabkan **nomor WhatsApp Anda diblokir (banned/banned permanent)**.
> - **DILARANG** menggunakan proyek ini untuk aktivitas spamming, broadcast massal tanpa izin penerima, penipuan, atau tindakan yang melanggar hukum dan *WhatsApp Terms of Service*.
> - Penulis/pembuat repositori **tidak bertanggung jawab** atas segala kerugian, pemblokiran akun, atau konsekuensi hukum yang timbul dari penggunaan repositori ini. Segala risiko ditanggung sepenuhnya oleh pengguna.

---

## 📋 Fitur

- 📱 **QR Code Web Dashboard**: Scan QR langsung melalui browser via WebSocket real-time (`/api/connect`).
- 🔐 **Autentikasi API Key**: Proteksi endpoint pengiriman pesan dengan header `x-api-key`.
- 📊 **Logging ke Database**: Log status pengiriman pesan (sent, delivered, read, failed) tersimpan ke MySQL.
- 🔄 **Auto-Reconnect & Lock Cleanup**: Mekanisme auto-recovery session dan pembersihan file lock Chromium.
- 🚀 **PM2 Ready**: Dilengkapi konfigurasi cluster single-instance PM2 dan script auto-deploy untuk Ubuntu dan Windows.

---

## 💻 Prasyarat Sistem

1. **Node.js**: Versi LTS 18.x atau 20.x ke atas.
2. **NPM**: Bawaan Node.js.
3. **MySQL Server**: Versi 8.0+ atau MariaDB 10.4+.
4. **Chromium / Google Chrome**:
   - Di Windows: Menggunakan Chromium bawaan Puppeteer atau Chrome lokal.
   - Di Linux Server (Ubuntu/Debian): Wajib menginstal browser Chromium dan dependensi headless:
     ```bash
     sudo apt update
     sudo apt install -y chromium-browser \
       gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 \
       libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 \
       libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 \
       libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
       libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 \
       libxtst6 ca-certificates fonts-liberation libnss3 lsb-release xdg-utils
     ```

---

## 🚀 Panduan Instalasi

1. **Clone Repositori**:
   ```bash
   git clone <url-repository-anda>
   cd wwebjs
   ```

2. **Install Dependensi Node.js**:
   ```bash
   npm install
   ```

3. **Siapkan Database MySQL**:
   - Buat database baru di MySQL (misal: `whatsapp`).
   - Import tabel dari file `logs.sql`:
     ```bash
     mysql -u root -p whatsapp < logs.sql
     ```
   *(Catatan: Aplikasi juga memiliki fitur auto-create table saat pertama kali dijalankan jika koneksi MySQL berhasil).*

---

## ⚙️ Konfigurasi

Salin file template `.env.example` menjadi `.env`:

```bash
# Linux / macOS
cp .env.example .env

# Windows (Command Prompt / PowerShell)
copy .env.example .env
```

Buka dan sesuaikan isi file `.env`:

```ini
# Port server Express
PORT=3000

# Kunci rahasia untuk mengakses API send-message (ganti dengan string acak dan aman)
API_KEY=rahasia-api-key-anda-minimal-32-karakter

# URL redirect ketika mengakses route root (/)
APP_MAINPAGE=https://web.whatsapp.com

# Konfigurasi Koneksi Database MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=password_db_anda
DB_NAME=whatsapp

# Path Chromium (Kosongkan jika di Windows / pakai bawaan Puppeteer)
# Untuk Ubuntu Server biasanya: /usr/bin/chromium-browser atau /usr/bin/chromium
PUPPETEER_EXECUTABLE_PATH=

# Environment mode
NODE_ENV=production
```

---

## 🏃 Menjalankan Aplikasi

### 1. Mode Development
```bash
npm run dev
```

### 2. Mode Standar / Production
```bash
npm start
```

### 3. Mode PM2 (Process Manager)
Untuk server production, disarankan menggunakan PM2:
```bash
# Menjalankan service via PM2
npm run pm2:start

# Memantau log real-time
npm run pm2:logs

# Merestart service
npm run pm2:restart

# Menghentikan service
npm run pm2:stop
```

> **Catatan Penting PM2**: Instance pada `ecosystem.config.js` **HARUS bernilai 1** karena satu sesi akun WhatsApp tidak dapat dijalankan secara paralel.

---

## 📲 Menghubungkan WhatsApp (Scan QR)

1. Jalankan aplikasi hingga server aktif.
2. Buka browser dan akses halaman dashboard:
   ```
   http://localhost:3000/api/connect
   ```
3. Buka aplikasi **WhatsApp** di smartphone Anda > pilih menu **Perangkat Tertaut (Linked Devices)** > **Tautkan Perangkat**.
4. Scan QR code yang muncul di layar.
5. Tunggu hingga status berubah menjadi **Connected / Siap Digunakan**.

---

## 📡 Dokumentasi Endpoint API

### 1. Cek Status Koneksi WhatsApp
- **Endpoint**: `GET /api/status`
- **Header**: *Tidak memerlukan API Key*
- **Response Contoh**:
  ```json
  {
    "success": true,
    "status": "ready",
    "ready": true
  }
  ```

---

### 2. Kirim Pesan Teks
- **Endpoint**: `POST /api/send-message`
- **Headers**:
  - `Content-Type: application/json`
  - `x-api-key: <API_KEY_ANDA>`
- **Request Body**:
  ```json
  {
    "number": "081234567890",
    "message": "Halo! Ini adalah pesan uji coba untuk pembelajaran.",
    "sender": "System Tester"
  }
  ```
  *(Format nomor telepon dapat diawali `08...`, `628...`, atau `+628...`, sistem akan otomatis memformat ke nomor internasional).*

- **Response Sukses (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Pesan berhasil dikirim",
    "data": {
      "id": 1,
      "messageId": "true_6281234567890@c.us_3EB0...",
      "receiver": "6281234567890",
      "message": "Halo! Ini adalah pesan uji coba untuk pembelajaran.",
      "timestamp": "2026-09-13T14:48:00.000Z"
    }
  }
  ```

- **Contoh Permintaan Menggunakan cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/send-message \
    -H "Content-Type: application/json" \
    -H "x-api-key: rahasia-api-key-anda-minimal-32-karakter" \
    -d '{
      "number": "081234567890",
      "message": "Halo dari API WhatsApp Gateway",
      "sender": "Admin"
    }'
  ```

---

## 🗂️ Struktur Direktori

```text
├── public/                 # File antarmuka web (QR Connect Dashboard)
│   ├── index.html
│   └── style.css
├── src/
│   ├── controllers/        # Handler request HTTP (waController.js)
│   ├── middleware/         # Middleware autentikasi API Key
│   ├── routes/             # Definisi routing API (/api/connect, /api/status, dll.)
│   ├── services/           # Service WhatsApp (whatsapp-web.js) & Socket.IO
│   ├── config.js           # Konfigurasi environment variabel
│   └── db.js               # Inisialisasi pool koneksi MySQL & query log
├── .env.example            # Template konfigurasi environment
├── .gitignore              # Daftar file yang diabaikan Git
├── deploy.sh               # Script auto-deploy untuk Linux (Ubuntu)
├── deploy.bat              # Script auto-deploy untuk Windows
├── ecosystem.config.js     # Konfigurasi PM2 production
├── logs.sql                # Skema database tabel log pesan
├── package.json
├── README.md
└── server.js               # Entry point utama aplikasi
```

---

## 📜 Lisensi & Etika Penggunaan

Proyek ini didistribusikan untuk tujuan edukasi. Harap gunakan secara bijak dan patuhi kebijakan WhatsApp serta regulasi privasi yang berlaku di wilayah Anda.
