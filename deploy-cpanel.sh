#!/bin/bash
# WhatsApp Gateway — deploy 1 perintah khusus cPanel/shared hosting (TANPA sudo).
#
# Cukup jalankan SATU perintah ini di folder projek:
#   bash deploy-cpanel.sh
# (Pakai 'bash ...' bukan './...' karena partisi hosting umumnya noexec
#  sehingga ./deploy-cpanel.sh -> Permission denied walau sudah chmod +x.)
#
# Yang dilakukan otomatis:
#   1. cek docker + docker compose v2 (TOLAK docker-compose v1 yang rusak libz.so.1)
#   2. siapkan .env (buat baru jika belum ada, paksa PORT=3000,
#      map DB_HOST=localhost/127.0.0.1 -> host.docker.internal)
#   3. build image wwebjs (retry DOCKER_BUILDKIT=0 seperti cara manual yang terbukti jalan)
#   4. up container wwebjs port 3000 saja + volume session persisten
#   5. tunggu /health + tampilkan cara scan QR
#
# Perintah lain (semua via 'bash' agar lolos noexec):
#   bash deploy-cpanel.sh update    # git pull + build + restart (pakai ini setelah ada update)
#   bash deploy-cpanel.sh rebuild   # build ulang tanpa cache + restart
#   bash deploy-cpanel.sh logs      # ikuti log
#   bash deploy-cpanel.sh status    # status + cek /health + /api/status
#   bash deploy-cpanel.sh restart   # restart container
#   bash deploy-cpanel.sh down      # hentikan (volume session tetap)

APP_PORT="3000"
COMPOSE_FILE="docker-compose.cpanel.yml"
IMAGE_NAME="wwebjs"
CONTAINER_NAME="wwebjs"

log() { echo -e "$1"; }
die() { echo -e "❌ [ERROR] $1" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1; }

[ -f "Dockerfile" ] || die "Dockerfile tidak ditemukan. Jalankan dari folder projek wwebjs."
[ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE tidak ditemukan."

# Hanya docker compose v2 (plugin). Jangan pakai docker-compose v1 (rusak di hosting ini).
compose() {
  if need_cmd docker && docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  else
    die "Butuh 'docker compose' v2. Terdeteksi: $(docker compose version 2>&1 || echo 'tidak ada'). Jangan pakai docker-compose v1."
  fi
}

check_docker() {
  need_cmd docker || die "docker tidak ditemukan di PATH."
  docker info >/dev/null 2>&1 || die "'docker info' gagal. Pastikan akses docker kamu aktif."
  log "✅ [DOCKER] $(docker --version) | $(docker compose version)"
}

# Ambil nilai VAR dari .env (tanpa source, aman dari spasi/komentar)
env_val() {
  grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^["'\'']//;s/["'\'']$//'
}

# Set atau tambah VAR=VALUE di .env (kompatibel GNU/BSD, tanpa sudo)
env_set() {
  _k="$1"; _v="$2"
  if grep -qE "^${_k}=" .env 2>/dev/null; then
    sed "s|^${_k}=.*|${_k}=${_v}|" .env > .env.tmp && mv .env.tmp .env
  else
    echo "${_k}=${_v}" >> .env
  fi
}

setup_env() {
  if [ ! -f ".env" ]; then
    log "📝 [ENV] .env belum ada — membuat dari .env.example dengan default cPanel..."
    [ -f ".env.example" ] || die ".env & .env.example tidak ada."
    cp .env.example .env
    # Default samakan dengan aplikasi satunya di hosting yang sama
    grep -qE "^DB_NAME=" .env || echo "DB_NAME=gemaantik_db" >> .env
    grep -qE "^DB_USER=" .env || echo "DB_USER=gemaantik_root" >> .env
  fi
  # 1. Paksa PORT=3000 (hosting hanya buka 3000, WA_API_URL pakai 127.0.0.1:3000)
  env_set "PORT" "$APP_PORT"
  # 2. Map localhost -> host.docker.internal (localhost di dalam container != host)
  _host="$(env_val DB_HOST)"
  if [ "$_host" = "localhost" ] || [ "$_host" = "127.0.0.1" ] || [ -z "$_host" ]; then
    env_set "DB_HOST" "host.docker.internal"
    log "🔄 [ENV] DB_HOST '${_host:-kosong}' -> 'host.docker.internal' (akses MySQL host dari container)."
  fi
  grep -qE "^DB_PORT=" .env || env_set "DB_PORT" "3306"
  grep -qE "^DB_NAME=" .env || env_set "DB_NAME" "gemaantik_db"
  grep -qE "^DB_USER=" .env || env_set "DB_USER" "gemaantik_root"
  grep -qE "^NODE_ENV=" .env || env_set "NODE_ENV" "production"
  if grep -qE "^(API_KEY=.*(ganti-dengan|your-secret|changeme|12345)|API_KEY=)$" .env; then
    log "⚠️  [ENV] API_KEY masih default — samakan dengan WA_API_KEY aplikasi satunya, lalu ulangi bash deploy-cpanel.sh"
  fi
  log "✅ [ENV] Siap (PORT=$APP_PORT, DB_HOST=$(env_val DB_HOST), DB_NAME=$(env_val DB_NAME))."
}

do_build() {
  log "🔨 [BUILD] Membangun image ${IMAGE_NAME} (reuse cache node bila ada)..."
  if docker build -t "$IMAGE_NAME" .; then
    log "✅ [BUILD] Sukses."
  else
    log "⚠️  [BUILD] Build biasa gagal — retry dengan DOCKER_BUILDKIT=0 (cara manual yang terbukti jalan)..."
    DOCKER_BUILDKIT=0 docker build -t "$IMAGE_NAME" . || die "Build gagal dua-duanya. Cek 'docker logs' / output di atas."
    log "✅ [BUILD] Sukses via DOCKER_BUILDKIT=0."
  fi
}

do_build_nocache() {
  log "🔨 [REBUILD] Build ulang tanpa cache..."
  if docker build --no-cache -t "$IMAGE_NAME" .; then
    log "✅ [BUILD] Sukses."
  else
    log "⚠️  [BUILD] Retry dengan DOCKER_BUILDKIT=0 --no-cache..."
    DOCKER_BUILDKIT=0 docker build --no-cache -t "$IMAGE_NAME" . || die "Rebuild gagal."
  fi
}

do_up() {
  log "🚀 [UP] Menjalankan container ${CONTAINER_NAME} (port ${APP_PORT} saja)..."
  if ! compose up -d; then
    # Fallback umum di shared hosting: daemon menolak shm_size
    if compose config 2>&1 | grep -qi "shm"; then
      log "⚠️  [UP] Gagal, kemungkinan daemon menolak 'shm_size'. Coba hapus baris 'shm_size: 2g' di $COMPOSE_FILE lalu ulangi."
    fi
    die "compose up gagal. Lihat output di atas."
  fi
}

wait_healthy() {
  log "⏳ [WAIT] Menunggu /health (maks ~120 dtk)..."
  for _ in $(seq 1 60); do
    if need_cmd curl && curl -fs -m 3 "http://localhost:${APP_PORT}/health" >/dev/null 2>&1; then
      _db="$(curl -fs -m 3 "http://localhost:${APP_PORT}/health" 2>/dev/null | grep -o '"up":[a-z]*' | head -n1)"
      log "✅ [WAIT] Merespons di port ${APP_PORT} (${_db:-db:?})."
      return 0
    fi
    sleep 2
  done
  log "⚠️  [WAIT] Timeout — cek 'bash deploy-cpanel.sh logs'. Container mungkin masih init Chrome/QR."
}

show_info() {
  echo "==================================================="
  echo "✅ wwebjs berjalan (cPanel, port ${APP_PORT})"
  echo "==================================================="
  compose ps
  echo "---------------------------------------------------"
  echo "🌐 Root    : http://127.0.0.1:${APP_PORT}/"
  echo "📊 Health  : curl http://127.0.0.1:${APP_PORT}/health"
  echo "📊 Status  : curl http://127.0.0.1:${APP_PORT}/api/status -H \"x-api-key: \$API_KEY\""
  echo "📱 QR JSON : curl http://127.0.0.1:${APP_PORT}/api/qr -H \"x-api-key: \$API_KEY\""
  echo "📱 QR PNG  : curl \"http://127.0.0.1:${APP_PORT}/api/qr?format=png\" -H \"x-api-key: \$API_KEY\" --output qr.png"
  echo "📜 Log     : bash deploy-cpanel.sh logs"
  echo "♻️  Session : volume wwebjs-session (scan QR 1x, survive rebuild/restart)"
  echo "==================================================="
}

cmd_install() {
  check_docker
  setup_env
  do_build
  do_up
  wait_healthy
  show_info
}

do_git_pull() {
  if [ ! -d ".git" ]; then
    log "ℹ️  [GIT] Bukan repo git (.git tidak ada) — lewati pull."
    return 0
  fi
  need_cmd git || die "git tidak ditemukan, tidak bisa update."
  log "📦 [GIT] Menarik perubahan terbaru..."
  if git pull --ff-only 2>/dev/null; then
    log "✅ [GIT] $(git log --oneline -1)"
  else
    log "⚠️  [GIT] pull --ff-only gagal (mungkin ada perubahan lokal). Coba pull biasa..."
    git pull || log "⚠️  [GIT] Git pull gagal — lanjut deploy dengan kode yang ada. Selesaikan konflik manual lalu ulangi."
  fi
}

cmd_update() {
  check_docker
  do_git_pull
  setup_env
  do_build
  do_up
  wait_healthy
  show_info
}

case "${1:-up}" in
  up|install|"") cmd_install ;;
  update) cmd_update ;;
  rebuild)
    check_docker; setup_env; do_build_nocache; do_up; wait_healthy; show_info ;;
  logs) compose logs -f wa-gateway ;;
  restart) compose restart; show_info ;;
  status)
    compose ps
    echo "--- /health ---"
    curl -s -m 5 "http://localhost:${APP_PORT}/health" || echo "⚠️  Port ${APP_PORT} belum merespons."
    ;;
  down) compose down; log "🛑 Dihentikan (volume wwebjs-session tetap, session tidak hilang)." ;;
  -h|--help|help)
    echo "Pakai SATU perintah: bash deploy-cpanel.sh"
    echo "Update kode + deploy: bash deploy-cpanel.sh update"
    echo "Opsi: bash deploy-cpanel.sh [up|update|rebuild|logs|status|restart|down]"
    ;;
  *) die "Argumen tidak dikenal: $1 (lihat bash deploy-cpanel.sh --help)" ;;
esac
