#!/bin/bash
# WhatsApp Gateway — installer & runner Docker untuk server (Ubuntu/Debian)
# Port aplikasi: 3000 (http://<IP-server>:3000)
#
# Penggunaan di server:
#   chmod +x docker.sh
#   ./docker.sh              # install Docker (jika perlu) + build + jalan
#   ./docker.sh rebuild      # build ulang tanpa cache + restart
#   ./docker.sh logs         # ikuti log wa-gateway
#   ./docker.sh restart      # restart service
#   ./docker.sh status       # status container + cek port 3000
#   ./docker.sh down         # hentikan service (data tetap)
#   ./docker.sh clean        # hentikan + hapus volume mysql (HATI-HATI: hapus data DB)
#
# Alur: pastikan Docker -> siapkan .env (PORT=3000) -> compose build/up ->
# tunggu MySQL healthy + port 3000 listen -> tampilkan cara scan QR.

set -euo pipefail

APP_PORT="3000"
COMPOSE_FILE="docker-compose.yml"

log()  { echo -e "$1"; }
die()  { echo -e "❌ [ERROR] $1" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1; }

# 0. Wajib dijalankan dari folder projek (ada Dockerfile + compose)
[ -f "Dockerfile" ] || die "Dockerfile tidak ditemukan. Jalankan dari folder projek wwebjs."
[ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE tidak ditemukan."

# 1. Docker Compose wrapper (dukung plugin v2 & biner lama)
compose() {
  if need_cmd docker && docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  elif need_cmd docker-compose; then
    docker-compose -f "$COMPOSE_FILE" "$@"
  else
    die "Docker Compose tidak ditemukan."
  fi
}

install_docker() {
  if need_cmd docker; then
    log "✅ [DOCKER] Docker sudah terinstal: $(docker --version)"
    return
  fi
  log "📦 [DOCKER] Menginstal Docker (Ubuntu/Debian)..."
  need_cmd apt-get || die "Hanya mendukung Ubuntu/Debian (apt-get tidak ada)."
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg lsb-release
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
$(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker || true
  log "✅ [DOCKER] Instalasi selesai: $(docker --version)"
}

# 2. Siapkan .env (salin dari contoh bila belum ada) + paksa PORT=3000
setup_env() {
  if [ ! -f ".env" ]; then
    [ -f ".env.example" ] || die ".env & .env.example tidak ada."
    cp .env.example .env
    log "📝 [ENV] .env dibuat dari .env.example — HARAP sesuaikan API_KEY & kredensial DB."
  fi
  # Paksa PORT=3000 (kompatibel GNU & BSD sed via file temp)
  if grep -qE "^PORT=" .env; then
    sed "s/^PORT=.*/PORT=${APP_PORT}/" .env > .env.tmp && mv .env.tmp .env
  else
    echo "PORT=${APP_PORT}" >> .env
  fi
  # Default aman bila variabel DB kosong (dipakai compose untuk service mysql)
  grep -qE "^DB_NAME=" .env || echo "DB_NAME=whatsapp" >> .env
  grep -qE "^DB_USER=" .env || echo "DB_USER=wa_user" >> .env
  grep -qE "^DB_PASS=" .env || echo "DB_PASS=changeme" >> .env
  grep -qE "^MYSQL_ROOT_PASSWORD=" .env || echo "MYSQL_ROOT_PASSWORD=rootpass" >> .env
  # Peringatan API key default
  if grep -qE "^(API_KEY=.*(ganti-dengan|your-secret|changeme|12345)|API_KEY=)$" .env; then
    log "⚠️  [ENV] API_KEY masih default — ganti di .env dengan string acak minimal 32 karakter."
  fi
  log "✅ [ENV] PORT dipaksa ke ${APP_PORT}."
}

# 3. Folder persistensi (session WA, cache, logs)
setup_dirs() {
  mkdir -p .wwebjs_auth .wwebjs_cache logs
  log "📁 [FS] Folder .wwebjs_auth, .wwebjs_cache, logs siap."
}

# 4. Firewall: buka port app bila ufw aktif
setup_firewall() {
  if need_cmd ufw && sudo ufw status 2>/dev/null | grep -q "Status: active"; then
    sudo ufw allow "${APP_PORT}/tcp" || true
    log "🔥 [UFW] Port ${APP_PORT}/tcp diizinkan."
  fi
}

wait_healthy() {
  log "⏳ [WAIT] Menunggu MySQL healthy + port ${APP_PORT} listen (maks ~120 dtk)..."
  for _ in $(seq 1 60); do
    if compose ps 2>/dev/null | grep -qiE "healthy|Up"; then
      if (command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ":${APP_PORT} ") \
        || (command -v curl >/dev/null && curl -fs -m 3 "http://localhost:${APP_PORT}/" >/dev/null 2>&1); then
        log "✅ [WAIT] Aplikasi merespons di port ${APP_PORT}."
        return 0
      fi
    fi
    sleep 2
  done
  log "⚠️  [WAIT] Timeout — cek 'docker.sh logs' untuk detail."
}

show_info() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -z "${ip:-}" ] && ip="<IP-server>"
  echo "==================================================="
  echo "✅ WhatsApp Gateway berjalan via Docker (port ${APP_PORT})"
  echo "==================================================="
  compose ps
  echo "---------------------------------------------------"
  echo "🌐 Root    : http://${ip}:${APP_PORT}/"
  echo "📊 Status  : GET http://${ip}:${APP_PORT}/api/status (header x-api-key)"
  echo "📱 QR scan : GET http://${ip}:${APP_PORT}/api/qr (header x-api-key)"
  echo "📜 Log     : ./docker.sh logs"
  echo "==================================================="
}

cmd_up() {
  install_docker
  setup_env
  setup_dirs
  setup_firewall
  log "🔨 [BUILD] Membangun image wa-gateway..."
  compose build
  log "🚀 [UP] Menjalankan stack (wa-gateway + mysql)..."
  compose up -d
  wait_healthy
  show_info
}

cmd_rebuild() {
  install_docker
  setup_env
  setup_dirs
  log "🔨 [REBUILD] Build ulang tanpa cache..."
  compose build --no-cache
  compose up -d
  wait_healthy
  show_info
}

case "${1:-up}" in
  up|"")        cmd_up ;;
  rebuild)      cmd_rebuild ;;
  logs)         compose logs -f wa-gateway ;;
  restart)      compose restart; show_info ;;
  status)       compose ps; curl -s -m 5 "http://localhost:${APP_PORT}/" || echo "⚠️  Port ${APP_PORT} belum merespons." ;;
  down)         compose down; log "🛑 Stack dihentikan (volume data tetap)." ;;
  clean)        die "Batal. Konfirmasi manual: 'docker compose -f $COMPOSE_FILE down -v' (MENGHAPUS DATA MySQL).";;
  -h|--help|help)
    echo "Pakai: ./docker.sh [up|rebuild|logs|restart|status|down|clean]"
    ;;
  *) die "Argumen tidak dikenal: $1 (lihat ./docker.sh --help)" ;;
esac
