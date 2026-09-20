#!/usr/bin/env bash
# Postgres 논리 백업 → Cloudflare R2(별도 백업 버킷). 04-backup-setup.sh가 cron에 건다.
#
# 사진 버킷과 분리하는 이유: 사진 버킷 키가 유출/오조작돼도 백업이 같이 날아가면
# 안 된다. 백업 전용 R2 API 토큰(백업 버킷 한정 Object Read & Write)을 따로 쓴다.
#
# 설정: ~/.practivetts-backup.env (chmod 600) — 04-backup-setup.sh가 양식을 만든다.
#   BACKUP_R2_ACCOUNT_ID / BACKUP_R2_ACCESS_KEY_ID / BACKUP_R2_SECRET_ACCESS_KEY
#   BACKUP_R2_BUCKET
#   BACKUP_PING_URL   성공 시 GET(04-backup-setup.sh는 필수로 요구한다) — healthchecks.io 등 "안 오면 알림" 서비스.
#                     cron이 조용히 죽는 것을 잡는 유일한 장치다.
# DB 접속 정보는 backend/.env의 DB_HOST/PORT/USERNAME/PASSWORD/DATABASE를 그대로 쓴다.
#
# 보존 기간(14일)은 R2 버킷의 Lifecycle 규칙으로 건다(DEPLOYMENT.md 참고) —
# 이 스크립트는 지우지 않는다.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/practivetts}"
BACKUP_ENV="${BACKUP_ENV:-$HOME/.practivetts-backup.env}"

# .env는 source하지 않고 필요한 키만 뽑는다(값에 공백·특수문자가 있어도 안전).
# 키가 없거나 값이 비어 있어도 빈 문자열을 돌려주고 실패하지 않는다(set -e·pipefail 하에서
# grep 무매치가 스크립트를 소리 없이 죽이지 않도록 || true).
get_env() {
  local file="$1" key="$2"
  grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//" || true
}

[ -f "$BACKUP_ENV" ] || { echo "!! $BACKUP_ENV 가 없습니다. 04-backup-setup.sh를 먼저 실행하세요." >&2; exit 1; }
[ -f "$APP_DIR/backend/.env" ] || { echo "!! $APP_DIR/backend/.env 가 없습니다." >&2; exit 1; }

R2_ACCOUNT_ID="$(get_env "$BACKUP_ENV" BACKUP_R2_ACCOUNT_ID)"
R2_KEY_ID="$(get_env "$BACKUP_ENV" BACKUP_R2_ACCESS_KEY_ID)"
R2_SECRET="$(get_env "$BACKUP_ENV" BACKUP_R2_SECRET_ACCESS_KEY)"
R2_BUCKET="$(get_env "$BACKUP_ENV" BACKUP_R2_BUCKET)"
PING_URL="$(get_env "$BACKUP_ENV" BACKUP_PING_URL)"
for v in R2_ACCOUNT_ID R2_KEY_ID R2_SECRET R2_BUCKET; do
  [ -n "${!v}" ] || { echo "!! $BACKUP_ENV 에 BACKUP_${v} 값이 비어 있습니다." >&2; exit 1; }
done

# 앱(backend/src/database/database.module.ts)과 같은 기본값 — .env가 비어 있어도 앱이 뜨는
# 배포에서 백업만 다른 유저·DB로 접속하지 않도록 맞춘다. 앱 기본값을 바꾸면 여기도 바꿀 것.
DB_ENV="$APP_DIR/backend/.env"
export PGHOST="$(get_env "$DB_ENV" DB_HOST)"; PGHOST="${PGHOST:-localhost}"
export PGPORT="$(get_env "$DB_ENV" DB_PORT)"; PGPORT="${PGPORT:-5432}"
export PGUSER="$(get_env "$DB_ENV" DB_USERNAME)"; PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="$(get_env "$DB_ENV" DB_PASSWORD)"
DB_NAME="$(get_env "$DB_ENV" DB_DATABASE)"; DB_NAME="${DB_NAME:-memorylink}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
KEY="daily/${DB_NAME}-${STAMP}.dump"
TMP="$(mktemp -t practivetts-backup.XXXXXX)"
trap 'rm -f "$TMP"' EXIT

echo "pg_dump ${DB_NAME} → ${KEY}"
pg_dump --format=custom --no-owner --no-privileges --file="$TMP" "$DB_NAME"

# 중간에 잘린 덤프를 정상 백업처럼 올리면 복원하는 날에야 발견된다.
# 업로드 전에 pg_restore가 목차를 읽을 수 있는지 확인한다.
pg_restore --list "$TMP" >/dev/null
[ -s "$TMP" ] || { echo "!! 덤프 파일이 비어 있습니다." >&2; exit 1; }

AWS_ACCESS_KEY_ID="$R2_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET" AWS_DEFAULT_REGION=auto \
  aws s3 cp "$TMP" "s3://${R2_BUCKET}/${KEY}" \
  --endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" --only-show-errors

echo "백업 완료: s3://${R2_BUCKET}/${KEY} ($(wc -c <"$TMP") bytes)"

# 성공했을 때만 핑을 보낸다 — 핑이 끊기면 외부 서비스가 알림을 보낸다.
if [ -n "$PING_URL" ]; then
  curl -fsS -m 10 --retry 3 "$PING_URL" >/dev/null || echo "경고: 핑 전송 실패(백업 자체는 성공)" >&2
fi
