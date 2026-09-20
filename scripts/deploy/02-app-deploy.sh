#!/usr/bin/env bash
# 앱 코드 배포 — 01-server-setup.sh로 런타임(Node/Python/Postgres/nginx/pm2)이
# 이미 깔린 서버에서 실행한다. 첫 배포와 이후 재배포 둘 다 이 스크립트로.
#
# 사용법:
#   ~/deploy-scripts/02-app-deploy.sh [--force] <git-repo-url> [branch]
# 예:
#   ~/deploy-scripts/02-app-deploy.sh git@github.com:wonseokjee/practiceTTS.git main
#
# 치료 시간대 가드:
#   단일 인스턴스라 pm2 reload가 잠깐 요청을 끊는다. 치료 시간대(기본 한국 09~21시,
#   21시 정각부터는 허용)에 실행하면 아무것도 건드리지 않고 멈춘다. 급한 핫픽스만
#   --force로 통과시킨다. 시간대는 환경변수로 조정한다:
#     DEPLOY_WINDOW_TZ(기본 Asia/Seoul) DEPLOY_WINDOW_START(9) DEPLOY_WINDOW_END(21)
#   (DEPLOY_NOW_HOUR는 테스트용 — 현재 시각(시)을 대신한다.)
#
# 전제:
#   - /opt/practivetts에 클론할 권한(sudo mkdir + chown 필요할 수 있음)
#   - backend/.env, ai-service/.env, frontend/.env가 이미 /opt/practivetts에
#     채워져 있어야 한다(이 스크립트는 .env를 만들지도 덮어쓰지도 않는다 —
#     .env.example만 참고해 서버에서 직접 채울 것. CRYPTO_SECRET_KEY 같은
#     값은 한 번 정하면 되돌릴 수 없다).
#   - PostgreSQL에 DB·유저가 이미 만들어져 있어야 한다(01-server-setup.sh
#     안내 참고).

set -euo pipefail

# --force는 위치와 무관하게 받는다. 나머지는 <git-repo-url> [branch] 그대로.
FORCE=0
ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--force" ]; then FORCE=1; else ARGS+=("$arg"); fi
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

# 어떤 작업(git fetch, 빌드, 마이그레이션)보다 먼저 검사한다 — 막힐 때는 서버에 흔적이 없어야 한다.
WINDOW_TZ="${DEPLOY_WINDOW_TZ:-Asia/Seoul}"
WINDOW_START="${DEPLOY_WINDOW_START:-9}"
WINDOW_END="${DEPLOY_WINDOW_END:-21}"
NOW_HOUR="${DEPLOY_NOW_HOUR:-$(TZ="$WINDOW_TZ" date +%H)}"
NOW_HOUR=$((10#$NOW_HOUR))
if [ "$NOW_HOUR" -ge "$WINDOW_START" ] && [ "$NOW_HOUR" -lt "$WINDOW_END" ]; then
  if [ "$FORCE" -eq 1 ]; then
    echo "!! 치료 시간대(${WINDOW_TZ} ${WINDOW_START}~${WINDOW_END}시, 지금 ${NOW_HOUR}시)이지만 --force로 진행합니다." >&2
  else
    echo "!! 치료 시간대(${WINDOW_TZ} ${WINDOW_START}~${WINDOW_END}시, 지금 ${NOW_HOUR}시)입니다. 배포 중 pm2 reload가 요청을 끊습니다." >&2
    echo "   시간대 밖에 다시 실행하거나, 급한 경우에만 --force를 붙이세요." >&2
    exit 1
  fi
fi

REPO_URL="${1:?사용법: 02-app-deploy.sh [--force] <git-repo-url> [branch]}"
BRANCH="${2:-main}"
APP_DIR="/opt/practivetts"

echo "=== 1/6: 코드 가져오기 (${REPO_URL} @ ${BRANCH}) ==="
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull origin "$BRANCH"
else
  sudo mkdir -p "$APP_DIR"
  sudo chown "$(whoami)":"$(whoami)" "$APP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# .env 존재 확인 — 없으면 여기서 멈춘다(빈 값으로 기동하면 CRYPTO_SECRET_KEY
# fail-closed 등으로 조용히 실패하거나, 최악의 경우 개발 기본값으로 뜬다).
# 존재하면 권한도 소유자 전용으로 조여둔다(비밀값이라 다른 로컬 유저가
# 읽을 수 있으면 안 된다 — umask 기본값은 보통 644라 그냥 두면 world-readable).
for f in backend/.env ai-service/.env frontend/.env; do
  if [ ! -f "$APP_DIR/$f" ]; then
    echo "!! $APP_DIR/$f 가 없습니다. $f.example을 참고해 먼저 채워주세요." >&2
    exit 1
  fi
  chmod 600 "$APP_DIR/$f"
done

echo "=== 2/6: backend 빌드 ==="
cd "$APP_DIR/backend"
npm ci
npm run build

echo "=== 3/6: backend 마이그레이션 실행 ==="
npm run migration:run

echo "=== 4/6: ai-service venv 준비 ==="
cd "$APP_DIR/ai-service"
if [ ! -d venv ]; then
  python3 -m venv venv
fi
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt

echo "=== 5/6: frontend 빌드 ==="
cd "$APP_DIR/frontend"
npm ci
npm run build
echo "frontend/dist 생성됨 — nginx root가 이 경로를 직접 서빙한다."

echo "=== 6/6: pm2로 기동/재기동 ==="
cd "$APP_DIR"
if pm2 describe practivetts-backend >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs
else
  pm2 start ecosystem.config.cjs
fi

# 현재 프로세스 목록을 저장한다 — 재부팅 후 pm2가 이 목록을 복원한다.
# 재배포 때마다 갱신해 둬야 나중에 앱이 추가/변경돼도 복원 목록이 어긋나지 않는다.
pm2 save

# 서버 재부팅 시 pm2가 자동으로 다시 뜨게 하는 systemd 유닛(pm2-<user>.service).
# 안내만 하고 넘기면 리부팅 한 번에 앱이 영영 안 뜨므로 직접 설치하고,
# 설치됐는지 확인한다. 이미 설치돼 있으면 건너뛴다(멱등).
PM2_UNIT="pm2-$(whoami).service"
if ! systemctl is-enabled "$PM2_UNIT" >/dev/null 2>&1; then
  sudo env PATH="$PATH" pm2 startup systemd -u "$(whoami)" --hp "$HOME"
fi
if ! systemctl is-enabled "$PM2_UNIT" >/dev/null 2>&1; then
  echo "!! $PM2_UNIT 이 활성화되지 않았습니다. 재부팅 시 앱이 자동 기동되지 않습니다." >&2
  echo "   'pm2 startup'이 출력하는 sudo 명령을 수동으로 실행한 뒤 다시 돌려주세요." >&2
  exit 1
fi
echo "재부팅 자동 기동 확인됨: $PM2_UNIT"

pm2 status

cat <<'EOF'

=== 배포 완료 ===
다음: DEPLOYMENT.md의 "스모크 체크리스트"로 실제 계정 1건 확인.
문제 생기면: pm2 logs practivetts-backend / pm2 logs practivetts-ai
EOF
