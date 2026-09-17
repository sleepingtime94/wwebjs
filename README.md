# WhatsApp Gateway API (wwebjs-gateway)

Gateway API berbasis Node.js untuk mengirim dan memantau pesan WhatsApp menggunakan library [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), Express (REST API murni), dan MySQL untuk pencatatan log pesan.

---

> ### ⚠️ PENTING: DISCLAIMER (HANYA UNTUK PEMBELAJARAN)
>
> Proyek ini dibuat **semata-mata untuk tujuan edukasi, penelitian, dan pembelajaran** mengenai interaksi headless browser (Puppeteer) dan arsitektur REST API di Node.js.
>
> - Proyek ini **BUKAN** produk resmi dan **TIDAK** berafiliasi, didukung, atau terkait dengan WhatsApp Inc. atau Meta Platforms, Inc.
> - WhatsApp melarang penggunaan bot atau otomatisasi tanpa otorisasi resmi melalui WhatsApp Business Cloud API. Penggunaan script/alat otomatisasi pihak ketiga berisiko menyebabkan **nomor WhatsApp Anda diblokir (banned/banned permanent)**.
> - **DILARANG** menggunakan proyek ini untuk aktivitas spamming, broadcast massal tanpa izin penerima, penipuan, atau tindakan yang melanggar hukum dan *WhatsApp Terms of Service*.
> - Penulis/pembuat repositori **tidak bertanggung jawab** atas segala kerugian, pemblokiran akun, atau konsekuensi hukum yang timbul dari penggunaan repositori ini. Segala risiko ditanggung sepenuhnya oleh pengguna.

---

## 📋 Fitur

- 📱 **QR Code via REST API**: Ambil QR sebagai JSON dataURL (`GET /api/qr`) atau gambar PNG (`GET /api/qr?format=png`), tanpa dashboard HTML.
- 🔐 **Autentikasi API Key di semua endpoint**: Proteksi seluruh endpoint `/api/*` via header `x-api-key` (atau `Authorization: Bearer`). API key via query string tidak diterima.
- 🛡️ **Proteksi Akun & Anti-Ban**:
  - **Message Queue persisten (FIFO)**: Pengiriman diproses berurutan, mencegah ledakan request serentak (*burst*). Job tersimpan di tabel `message_jobs` sehingga selamat dari restart dan dipulihkan otomatis saat boot, dengan retry + backoff otomatis.
  - **Human Typing & Presence Simulation**: Simulasi online/available, chat seen, dan status mengetik (*typing...*) sebelum pesan dikirim.
  - **Random Jitter Delay**: Jeda acak (misal 3–6 detik) antar pesan agar pola pengiriman terlihat manusiawi.
  - **Spintax Support**: Variasi kata otomatis `{Halo|Hai|Selamat pagi}` untuk menghindari deteksi spam teks identik.
  - **Puppeteer Stealth**: Menghapus flag automation bawaan browser (`AutomationControlled`).
- ⚡ **Optimasi Memori Chromium (Resource Blocking)**:
  - Memblokir pengunduhan media berat (video status, voice notes, audio) dan font eksternal non-esensial via Puppeteer request interception.
  - Membatasi renderer process (`--renderer-process-limit=2`) dan membatasi V8 heap size (`--max-old-space-size=512`) untuk menghemat konsumsi RAM server hingga 40–60%.
- 📊 **Logging ke Database**: Log status pengiriman pesan (sent, delivered, read, failed) tersimpan ke MySQL.
- 🏥 **Health Check**: Endpoint `GET /health` tanpa API key untuk Docker/K8s dan monitoring (status WA, DB, antrean).
- 🔄 **Auto-Reconnect & Lock Cleanup**: Mekanisme auto-recovery session dan pembersihan file lock Chromium.
- 🐳 **Docker Ready**: `Dockerfile` (Chrome headless bawaan) + `docker-compose.yml` (app + MySQL, port 3000) + `docker.sh` installer server.
- 🚀 **PM2 Ready**: Dilengkapi konfigurasi cluster single-instance PM2 dan script auto-deploy untuk Ubuntu dan Windows.

---

## 💻 Prasyarat Sistem

1. **Node.js**: Versi LTS 18.x atau 20.x ke atas.
2. **NPM**: Bawaan Node.js.
3. **MySQL Server**: Versi 8.0+ atau MariaDB 10.4+.
4. **Chromium / Google Chrome**:
   - Aplikasi otomatis mendeteksi Chrome dengan urutan: `PUPPETEER_EXECUTABLE_PATH` (.env) → cache bawaan Puppeteer → Chrome/Chromium sistem. Jika cache belum ada, jalankan `npm run setup:chrome`.
   - Di Windows: cukup gunakan Chrome yang sudah terinstal atau cache Puppeteer.
   - Di Linux Server non-Docker (Ubuntu/Debian): instal Google Chrome + dependensi headless (atau `chromium-browser`, lalu set `PUPPETEER_EXECUTABLE_PATH`):
     ```bash
     sudo apt update
     sudo apt install -y wget gnupg ca-certificates fonts-liberation \
       libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
       libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc-s1 \
       libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
       libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
       libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
       libxrandr2 libxrender1 libxss1 libxtst6 lsb-release xdg-utils
     wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
     sudo apt install -y /tmp/chrome.deb
     ```
   - Mode Docker: Chrome sudah termasuk di dalam image, tidak perlu instal manual.

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

# Kunci rahasia untuk mengakses seluruh endpoint /api/* (ganti dengan string acak dan aman)
API_KEY=rahasia-api-key-anda-minimal-32-karakter

# Konfigurasi Koneksi Database MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=password_db_anda
DB_NAME=whatsapp

# Path Chromium (opsional — kosongkan untuk auto-detect).
# Jika diisi dan file tidak ada, aplikasi lanjut ke cache Puppeteer / Chrome sistem.
# Contoh Linux: /usr/bin/google-chrome-stable | Contoh Windows: C:\Program Files\Google\Chrome\Application\chrome.exe
PUPPETEER_EXECUTABLE_PATH=

# Environment mode
NODE_ENV=production

# CORS: kosongkan = hanya same-origin/proxy (disarankan).
# Isi jika browser memanggil gateway langsung, pisahkan koma jika >1:
# CORS_ORIGIN=https://web-anda.com
CORS_ORIGIN=

# Batas body JSON & panjang pesan (karakter)
JSON_LIMIT=100kb
MESSAGE_MAX_LENGTH=4096
SENDER_MAX_LENGTH=50

# Konfigurasi Anti-Ban & Rate Limiter
RATE_LIMIT_MAX=30
RATE_LIMIT_WINDOW_MS=60000
ANTI_BAN_MIN_DELAY_MS=3000
ANTI_BAN_MAX_DELAY_MS=6000
ANTI_BAN_SIMULATE_TYPING=true
ANTI_BAN_ENABLE_SPINTAX=true

# Antrean persisten & timeout pengiriman
QUEUE_MAX_LENGTH=500
JOB_MAX_ATTEMPTS=3
JOB_RETRY_BASE_DELAY_MS=10000
WA_SEND_TIMEOUT_MS=30000
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

### 4. Mode Docker (disarankan untuk server, port 3000)
```bash
chmod +x docker.sh
./docker.sh          # install Docker bila perlu + build + jalan (app + MySQL)
./docker.sh logs     # ikuti log gateway
./docker.sh status   # cek status container & port 3000
```
`docker.sh` menyalin `.env.example` → `.env` bila belum ada dan memaksa `PORT=3000`. Session WhatsApp (`.wwebjs_auth`) dan `logs/` dipersist via volume.

---

## 📲 Menghubungkan WhatsApp (Scan QR via REST)

1. Jalankan aplikasi hingga server aktif.
2. Cek status koneksi:
   ```bash
   curl http://localhost:3000/api/status -H "x-api-key: <API_KEY_ANDA>"
   ```
3. Ambil QR code lalu scan dengan WhatsApp (**Perangkat Tertaut > Tautkan Perangkat**):
   ```bash
   # JSON (dataURL, untuk di-render di aplikasi sendiri)
   curl http://localhost:3000/api/qr -H "x-api-key: <API_KEY_ANDA>"

    # PNG langsung (pakai header, lalu render dari response; <img> tidak bisa kirim header)
    curl "http://localhost:3000/api/qr?format=png" -H "x-api-key: <API_KEY_ANDA>" --output qr.png
   ```
4. Untuk memutuskan sesi & meminta QR baru:
   ```bash
   curl -X POST http://localhost:3000/api/logout -H "x-api-key: <API_KEY_ANDA>"
   ```

---

## 📡 Dokumentasi Endpoint API

### 1. Cek Status Koneksi WhatsApp
- **Endpoint**: `GET /api/status`
- **Header**: `x-api-key: <API_KEY_ANDA>` (atau `Authorization: Bearer <API_KEY>`)
- **Response Contoh**:
  ```json
  {
    "success": true,
    "status": "ready",
    "ready": true,
    "me": { "phone": "6281234567890", "name": "Admin", "platform": "android" },
    "queue": { "queueLength": 0, "length": 0, "isProcessing": false }
  }
  ```
  *(QR tidak ada di sini — ambil khusus via `GET /api/qr` saat `status: "qr"`.)*

---

### 2. Ambil QR Code
- **Endpoint**: `GET /api/qr` (JSON dataURL) atau `GET /api/qr?format=png` (gambar PNG)
- **Header**: `x-api-key: <API_KEY_ANDA>`
- **Response**: `200 { success: true, status: "qr", qr: "data:image/png;base64,..." }`
  - `404` bila QR belum tersedia, `409` bila sudah terhubung (`ready: true`).

---

### 3. Logout (minta QR baru)
- **Endpoint**: `POST /api/logout`
- **Header**: `x-api-key: <API_KEY_ANDA>`
- **Response Contoh**:
  ```json
  { "success": true, "message": "Berhasil logout. Silakan scan QR baru via GET /api/qr.", "status": "reconnecting" }
  ```

---

### 4. Kirim Pesan Teks
- **Endpoint**: `POST /api/send-message`
- **Headers**:
  - `Content-Type: application/json`
  - `x-api-key: <API_KEY_ANDA>`
- **Request Body**:
  ```json
  {
    "number": "081234567890",
    "message": "{Halo|Hai|Selamat pagi} Bpk/Ibu, ini adalah pesan uji coba.",
    "sender": "System Tester",
    "async": false,
    "spintax": true,
    "simulateTyping": true
  }
  ```
  *(Catatan parameter):*
  - `number`: Nomor telepon tujuan (bisa format `08...`, `628...`, `+628...`, atau ID grup `xxx@g.us`).
  - `message`: Isi pesan. Mendukung format **Spintax** `{opsi1|opsi2|opsi3}` untuk memvariasikan teks otomatis.
  - `async` *(opsional, default `false`)*: Jika `true`, API langsung merespon status `queued` (202 Accepted) dan memproses pengiriman di latar belakang antrean. Jika `false`, API akan menunggu hingga pesan berhasil dikirim.
  - `spintax` *(opsional, default `true`)*: Aktifkan/nonaktifkan parser spintax.
  - `simulateTyping` *(opsional, default `true`)*: Aktifkan/nonaktifkan simulasi pengetikan manusiawi.

- **Response Sukses (200 OK - Sync Mode)**:
  ```json
  {
    "success": true,
    "message": "Pesan berhasil dikirim",
    "data": {
      "id": 1,
      "messageId": "true_6281234567890@c.us_3EB0...",
      "receiver": "6281234567890",
      "message": "Hai Bpk/Ibu, ini adalah pesan uji coba.",
      "originalMessage": "{Halo|Hai|Selamat pagi} Bpk/Ibu, ini adalah pesan uji coba.",
      "timestamp": 1726238880
    }
  }
  ```

- **Response Sukses (202 Accepted - Async Mode)**:
  ```json
  {
    "success": true,
    "status": "queued",
    "message": "Pesan telah dimasukkan ke dalam antrean pengiriman aman",
    "queueLength": 3
  }
  ```

- **Contoh Permintaan Menggunakan cURL**:
  ```bash
  curl -X POST http://localhost:3000/api/send-message \
    -H "Content-Type: application/json" \
    -H "x-api-key: rahasia-api-key-anda-minimal-32-karakter" \
    -d '{
      "number": "081234567890",
      "message": "{Halo|Hai} Pelanggan yang terhormat, terima kasih atas kepercayaan Anda!",
      "sender": "Admin"
    }'
  ```

- **Antrean persisten & retry**: setiap job tersimpan di tabel `message_jobs` sehingga selamat dari restart (dipulihkan otomatis saat boot). Job gagal di-retry otomatis (`JOB_MAX_ATTEMPTS`, default 3) dengan backoff. Antrean penuh → `429` (coba lagi nanti); client belum siap → `503`.

---

### 5. Health Check (tanpa API key, untuk Docker/monitoring)
- **Endpoint**: `GET /health`
- **Response**: `200 { success: true, service: "wwebjs-gateway", wa: { status, ready }, db: { up }, queue: {...} }`

---

## 🗂️ Struktur Direktori

```text
├── src/
│   ├── controllers/        # Handler request HTTP (waController.js)
│   ├── middleware/         # Middleware autentikasi API Key & rate limiter
│   ├── routes/             # Definisi routing API (/api/status, /api/qr, dll.)
│   ├── services/           # Service WhatsApp (whatsapp-web.js) & message queue
│   ├── config.js           # Konfigurasi environment variabel
│   └── db.js               # Inisialisasi pool koneksi MySQL & query log
├── Dockerfile              # Image Node 20 + Chrome headless (EXPOSE 3000, HEALTHCHECK /health)
├── docker-compose.yml      # Stack app + MySQL 8.0 (port 3000, volume session/logs)
├── docker.sh               # Installer & runner Docker untuk server Ubuntu/Debian
├── .dockerignore           # Daftar file yang dikecualikan dari image Docker
├── .env.example            # Template konfigurasi environment
├── .gitignore              # Daftar file yang diabaikan Git
├── deploy.sh               # Script auto-deploy non-Docker untuk Linux (Ubuntu)
├── deploy.bat              # Script auto-deploy non-Docker untuk Windows
├── ecosystem.config.js     # Konfigurasi PM2 production
├── logs.sql                # Skema database tabel log pesan
├── package.json
├── README.md
└── server.js               # Entry point utama aplikasi
```

---

## 📜 Lisensi & Etika Penggunaan

Proyek ini didistribusikan untuk tujuan edukasi. Harap gunakan secara bijak dan patuhi kebijakan WhatsApp serta regulasi privasi yang berlaku di wilayah Anda.
