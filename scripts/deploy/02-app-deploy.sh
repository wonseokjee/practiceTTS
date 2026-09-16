#!/usr/bin/env bash
# 앱 코드 배포 — 01-server-setup.sh로 런타임(Node/Python/Postgres/nginx/pm2)이
# 이미 깔린 서버에서 실행한다. 첫 배포와 이후 재배포 둘 다 이 스크립트로.
#
# 사용법:
#   ~/deploy-scripts/02-app-deploy.sh <git-repo-url> [branch]
# 예:
#   ~/deploy-scripts/02-app-deploy.sh git@github.com:wonseokjee/practiceTTS.git main
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

REPO_URL="${1:?사용법: 02-app-deploy.sh <git-repo-url> [branch]}"
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
for f in backend/.env ai-service/.env frontend/.env; do
  if [ ! -f "$APP_DIR/$f" ]; then
    echo "!! $APP_DIR/$f 가 없습니다. $f.example을 참고해 먼저 채워주세요." >&2
    exit 1
  fi
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
  pm2 save
  # 서버 재부팅 시 pm2가 자동으로 다시 뜨게 — 최초 1회만 필요.
  echo "최초 배포라면: 'pm2 startup'이 출력하는 sudo 명령을 한 번 실행해두세요."
fi

pm2 status

cat <<'EOF'

=== 배포 완료 ===
다음: DEPLOYMENT.md의 "스모크 체크리스트"로 실제 계정 1건 확인.
문제 생기면: pm2 logs practivetts-backend / pm2 logs practivetts-ai
EOF
