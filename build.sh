#!/bin/bash
# WhatsApp Gateway — deploy 1 perintah khusus cPanel/shared hosting (TANPA sudo).
#
# Cukup jalankan SATU perintah ini di folder projek:
#   bash build.sh
# (Pakai 'bash ...' bukan './...' karena partisi hosting umumnya noexec
#  sehingga ./build.sh -> Permission denied walau sudah chmod +x.)
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
#   bash build.sh update    # git pull + build + restart (pakai ini setelah ada update)
#   bash build.sh update-pkg # update whatsapp-web.js ke terbaru + build ulang docker + restart
#   bash build.sh rebuild   # build ulang tanpa cache + restart
#   bash build.sh logs      # ikuti log
#   bash build.sh status    # status + cek /health + /api/status
#   bash build.sh unlock    # DARURAT: hapus stale Chrome lock (error "profile in use") tanpa hapus session
#   bash build.sh restart   # restart container
#   bash build.sh down      # hentikan (volume session tetap)

APP_PORT="3000"
COMPOSE_FILE="docker-compose.cpanel.yml"
IMAGE_NAME="wwebjs"
CONTAINER_NAME="wwebjs"

log() { echo -e "$1"; }
die() { echo -e "❌ [ERROR] $1" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1; }

[ -f "Dockerfile" ] || die "Dockerfile tidak ditemukan. Jalankan dari folder projek wwebjs."
[ -f "$COMPOSE_FILE" ] || die "$COMPOSE_FILE tidak ditemukan."

# Deteksi plugin 'docker compose' v2 yang BENAR-BENAR berfungsi.
# (Di sebagian hosting plugin ada tapi rusak: "Invalid Plugins: compose failed to fetch metadata".)
COMPOSE_OK=0
for _try in 1 2; do
  if need_cmd docker && docker compose version 2>&1 | grep -qi "compose version"; then
    COMPOSE_OK=1; break
  fi
  sleep 1
done

# Cari volume existing (compose memberi prefix project, mis. wwebjs_wwebjs-session) agar session tidak hilang.
find_volume() {
  _v="$(docker volume ls -q 2>/dev/null | grep -E "(^|_)$1\$" | head -n1)"
  echo "${_v:-$1}"
}

# Fallback tanpa compose: jalankan container persis sesuai $COMPOSE_FILE via 'docker run'.
run_container() {
  _sv="$(find_volume wwebjs-session)"; _cv="$(find_volume wwebjs-cache)"
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  docker volume create "$_sv" >/dev/null; docker volume create "$_cv" >/dev/null
  log "ℹ️  [UP] docker compose tidak tersedia — pakai 'docker run' (volume: $_sv, $_cv)."
  set -- -d --name "$CONTAINER_NAME" --restart unless-stopped \
    -p "${APP_PORT}:3000" --env-file .env \
    -e PORT=3000 -e NODE_ENV=production -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    --add-host host.docker.internal:host-gateway \
    -v "$_sv:/app/.wwebjs_auth" -v "$_cv:/app/.wwebjs_cache" \
    --log-opt max-size=10m --log-opt max-file=3
  docker run "$@" --shm-size 2g "$IMAGE_NAME" || {
    log "⚠️  [UP] Gagal dengan --shm-size, coba tanpa..."
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    docker run "$@" "$IMAGE_NAME"
  }
}

compose() {
  if [ "$COMPOSE_OK" = "1" ]; then
    docker compose -f "$COMPOSE_FILE" "$@"
    return $?
  fi
  case "$1" in
    up) run_container ;;
    ps) docker ps -a --filter "name=^${CONTAINER_NAME}$" ;;
    logs) docker logs -f "$CONTAINER_NAME" ;;
    stop) docker stop "$CONTAINER_NAME" ;;
    restart) docker restart "$CONTAINER_NAME" ;;
    down) docker rm -f "$CONTAINER_NAME" ;;
    config) return 0 ;;
    *) die "Perintah compose '$1' tidak didukung pada mode fallback." ;;
  esac
}

check_docker() {
  need_cmd docker || die "docker tidak ditemukan di PATH."
  docker info >/dev/null 2>&1 || die "'docker info' gagal. Pastikan akses docker kamu aktif."
  if [ "$COMPOSE_OK" = "1" ]; then
    log "✅ [DOCKER] $(docker --version) | $(docker compose version)"
  else
    log "⚠️  [DOCKER] $(docker --version) | plugin compose rusak/tidak ada — mode fallback 'docker run'."
  fi
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
    log "⚠️  [ENV] API_KEY masih default — samakan dengan WA_API_KEY aplikasi satunya, lalu ulangi bash build.sh"
  fi
  chmod 600 .env 2>/dev/null || true
  _key="$(env_val API_KEY)"
  if [ "${#_key}" -lt 32 ]; then
    log "⚠️  [ENV] API_KEY < 32 karakter — disarankan key acak panjang (openssl rand -hex 32)."
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

# Hapus container sisa: compose merebut nama lama jadi "<hash12>_wwebjs" saat recreate;
# bila proses terputus (mis. SSH drop) container itu menetap dan memblokir nama "wwebjs".
cleanup_stale() {
  _stale="$(docker ps -a --format '{{.Names}}' | grep -E "^[0-9a-f]{12}_${CONTAINER_NAME}\$" || true)"
  if [ -n "$_stale" ]; then
    log "🧹 [CLEAN] Menghapus container sisa: $(echo "$_stale" | tr '\n' ' ')"
    echo "$_stale" | xargs docker rm -f >/dev/null 2>&1 || true
  fi
}

do_up() {
  log "🚀 [UP] Menjalankan container ${CONTAINER_NAME} (port ${APP_PORT} saja)..."
  cleanup_stale
  _out="$(mktemp)"
  if ! compose up -d 2>&1 | tee "$_out"; then :; fi
  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
    if grep -qi "already in use" "$_out"; then
      log "⚠️  [UP] Konflik nama container — hapus paksa lalu coba lagi..."
      compose down --remove-orphans >/dev/null 2>&1 || true
      cleanup_stale
      docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
      compose up -d || { rm -f "$_out"; die "compose up gagal. Lihat output di atas."; }
    else
      if grep -qi "shm" "$_out"; then
        log "⚠️  [UP] Daemon menolak 'shm_size'. Hapus baris 'shm_size: 2g' di $COMPOSE_FILE lalu ulangi."
      fi
      rm -f "$_out"
      die "compose up gagal. Lihat output di atas."
    fi
  fi
  rm -f "$_out"
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
  log "⚠️  [WAIT] Timeout — cek 'bash build.sh logs'. Container mungkin masih init Chrome/QR."
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
  echo "📜 Log     : bash build.sh logs"
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

do_update_pkg() {
  log "📦 [PKG] Update whatsapp-web.js ke commit terbaru GitHub main (package.json + package-lock.json)..."
  _before="$(grep -o '"whatsapp-web.js": *"[^"]*"' package.json | head -n1)"
  if need_cmd npm; then
    npm install "git+https://github.com/pedroslopez/whatsapp-web.js.git#main" --package-lock-only --ignore-scripts --no-audit --no-fund \
      || die "npm install whatsapp-web.js@latest gagal."
  else
    log "ℹ️  [PKG] npm host tidak ada — pakai container node:20-slim sekali-pakai."
    docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$(pwd)":/app -w /app node:20 \
      npm install "git+https://github.com/pedroslopez/whatsapp-web.js.git#main" --package-lock-only --ignore-scripts --no-audit --no-fund \
      || die "Update package via docker gagal."
  fi
  _after="$(grep -o '"whatsapp-web.js": *"[^"]*"' package.json | head -n1)"
  log "✅ [PKG] ${_before:-?}  ->  ${_after:-?}"
}

cmd_update_pkg() {
  check_docker
  setup_env
  # Backup agar bisa rollback otomatis bila update/build gagal
  cp package.json package.json.bak && cp package-lock.json package-lock.json.bak
  trap 'if [ -f package.json.bak ]; then mv -f package.json.bak package.json; mv -f package-lock.json.bak package-lock.json; echo "↩️  [PKG] Gagal — package.json & lock dikembalikan." >&2; fi' EXIT
  do_update_pkg
  do_build_nocache
  rm -f package.json.bak package-lock.json.bak
  trap - EXIT
  do_up
  wait_healthy
  show_info
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
  update-pkg|pkg) cmd_update_pkg ;;
  rebuild)
    check_docker; setup_env; do_build_nocache; do_up; wait_healthy; show_info ;;
  logs) docker logs -f --tail "${2:-200}" "$CONTAINER_NAME" ;;
  unlock)
    # Darurat error "profile appears to be in use": hapus file lock Chrome
    # (Singleton*) di volume TANPA menghapus session (tidak perlu scan QR ulang).
    # Dijalankan via container sekali-pakai dari image sendiri (pasti ada).
    log "🔓 [UNLOCK] Menghentikan container dulu agar lock tidak dipegang Chrome..."
    compose stop wa-gateway 2>/dev/null || docker stop "$CONTAINER_NAME" 2>/dev/null || true
    log "🔓 [UNLOCK] Menghapus stale lock files di volume wwebjs-session..."
    docker run --rm -v "$(find_volume wwebjs-session):/vol" "$IMAGE_NAME" \
      sh -c 'rm -f /vol/session/SingletonLock /vol/session/SingletonCookie /vol/session/SingletonSocket /vol/session/parent.lock; rm -f /vol/session-*/SingletonLock /vol/session-*/SingletonCookie /vol/session-*/SingletonSocket /vol/session-*/parent.lock; echo cleaned' \
      || die "Gagal membersihkan lock. Pastikan image $IMAGE_NAME sudah pernah di-build."
    log "🚀 [UNLOCK] Menyalakan kembali..."
    compose up -d; wait_healthy; show_info ;;
  restart) compose restart; show_info ;;
  status)
    compose ps
    echo "--- /health ---"
    curl -s -m 5 "http://localhost:${APP_PORT}/health" || echo "⚠️  Port ${APP_PORT} belum merespons."
    ;;
  down) compose down; log "🛑 Dihentikan (volume wwebjs-session tetap, session tidak hilang)." ;;
  -h|--help|help)
    echo "Pakai SATU perintah: bash build.sh"
    echo "Update kode + deploy: bash build.sh update"
    echo "Opsi: bash build.sh [up|update|update-pkg|rebuild|unlock|logs|status|restart|down]"
    ;;
  *) die "Argumen tidak dikenal: $1 (lihat bash build.sh --help)" ;;
esac
