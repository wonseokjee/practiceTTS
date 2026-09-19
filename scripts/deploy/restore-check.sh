#!/usr/bin/env bash
# 백업 복원 리허설 — 백업이 "있는 것"이 아니라 "복원되는 것"임을 확인한다.
# 임시 DB(practivetts_restore_check)에 복원해 테이블·users 행 수를 보고 지운다.
# 운영 DB는 건드리지 않는다.
#
# 사용법:
#   restore-check.sh latest
#   restore-check.sh daily/practivetts-20260919T183000Z.dump

set -euo pipefail

TARGET="${1:?사용법: restore-check.sh <latest|백업 키>}"
BACKUP_ENV="${BACKUP_ENV:-$HOME/.practivetts-backup.env}"
SCRATCH_DB="practivetts_restore_check"

get_env() {
  grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"
}

[ -f "$BACKUP_ENV" ] || { echo "!! $BACKUP_ENV 가 없습니다." >&2; exit 1; }
export AWS_ACCESS_KEY_ID="$(get_env "$BACKUP_ENV" BACKUP_R2_ACCESS_KEY_ID)"
export AWS_SECRET_ACCESS_KEY="$(get_env "$BACKUP_ENV" BACKUP_R2_SECRET_ACCESS_KEY)"
export AWS_DEFAULT_REGION=auto
BUCKET="$(get_env "$BACKUP_ENV" BACKUP_R2_BUCKET)"
ENDPOINT="https://$(get_env "$BACKUP_ENV" BACKUP_R2_ACCOUNT_ID).r2.cloudflarestorage.com"

if [ "$TARGET" = "latest" ]; then
  # 키에 UTC 타임스탬프가 들어 있어 사전순 마지막 = 최신.
  KEY="$(aws s3 ls "s3://${BUCKET}/daily/" --endpoint-url "$ENDPOINT" | awk '{print $4}' | sort | tail -1)"
  [ -n "$KEY" ] || { echo "!! s3://${BUCKET}/daily/ 에 백업이 없습니다." >&2; exit 1; }
  KEY="daily/${KEY}"
else
  KEY="$TARGET"
fi

TMP="$(mktemp -t practivetts-restore.XXXXXX)"
cleanup() {
  rm -f "$TMP"
  sudo -u postgres dropdb --if-exists "$SCRATCH_DB" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "다운로드: s3://${BUCKET}/${KEY}"
aws s3 cp "s3://${BUCKET}/${KEY}" "$TMP" --endpoint-url "$ENDPOINT" --only-show-errors

sudo -u postgres dropdb --if-exists "$SCRATCH_DB"
sudo -u postgres createdb "$SCRATCH_DB"
echo "복원 중(임시 DB: ${SCRATCH_DB})..."
# postgres 유저는 이 유저의 600 임시파일을 못 읽으므로 stdin으로 넘긴다.
sudo -u postgres pg_restore --no-owner --dbname="$SCRATCH_DB" < "$TMP"

TABLES="$(sudo -u postgres psql -At -d "$SCRATCH_DB" -c "select count(*) from information_schema.tables where table_schema='public'")"
USERS="$(sudo -u postgres psql -At -d "$SCRATCH_DB" -c "select count(*) from users")"
[ "$TABLES" -gt 0 ] || { echo "!! 테이블이 0개 — 빈 백업입니다." >&2; exit 1; }
echo "복원 성공: public 테이블 ${TABLES}개, users ${USERS}행"
