#!/usr/bin/env bash
# DB 백업 설치 — 02-app-deploy.sh 이후(코드와 backend/.env가 있는 상태)에 실행한다.
# 순서: 01 → 03 → 02 → 04.
#
# 사용법:
#   ~/deploy-scripts/04-backup-setup.sh
#
# 1) awscli 설치  2) ~/.practivetts-backup.env 양식 생성(없을 때만)
# 3) backup-db.sh를 1회 실제로 돌려 자격증명·덤프·업로드 전 경로를 검증
# 4) 검증이 통과했을 때만 매일 cron을 건다.
# 처음 실행하면 2)에서 양식만 만들고 멈춘다 — 값을 채운 뒤 다시 실행할 것.
# (설정이 틀린 채 cron만 걸어두면 매일 밤 조용히 실패한다.)
#
# 멱등: 재실행해도 안전하다(cron 파일은 덮어쓴다).

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/practivetts}"
BACKUP_ENV="${BACKUP_ENV:-$HOME/.practivetts-backup.env}"
BACKUP_SCRIPT="$APP_DIR/scripts/deploy/backup-db.sh"
CRON_FILE="${CRON_FILE:-/etc/cron.d/practivetts-backup}"

[ -f "$BACKUP_SCRIPT" ] || { echo "!! $BACKUP_SCRIPT 가 없습니다. 02-app-deploy.sh를 먼저 실행하세요." >&2; exit 1; }
chmod +x "$BACKUP_SCRIPT"

echo "=== 1/4: awscli 설치 ==="
# R2는 S3 호환 API라 aws cli로 올린다. Ubuntu 22.04 apt의 v1은 R2와 호환된다.
sudo apt-get install -y awscli curl

echo "=== 2/4: 설정 파일 ==="
if [ ! -f "$BACKUP_ENV" ]; then
  umask 077
  cat > "$BACKUP_ENV" <<'TEMPLATE'
# Cloudflare R2 백업 전용 버킷 + 그 버킷에만 권한을 가진 API 토큰.
# 사진 버킷 키를 재사용하지 말 것(키 하나가 새면 사진과 백업이 같이 날아간다).
BACKUP_R2_ACCOUNT_ID=
BACKUP_R2_ACCESS_KEY_ID=
BACKUP_R2_SECRET_ACCESS_KEY=
BACKUP_R2_BUCKET=
# 선택: 성공 시 GET할 URL(healthchecks.io 등). 이 핑이 끊기면 알림이 온다.
BACKUP_PING_URL=
TEMPLATE
  echo "$BACKUP_ENV 양식을 만들었습니다. 값을 채운 뒤 이 스크립트를 다시 실행하세요."
  echo "(DEPLOYMENT.md 「DB 백업」 절에 R2 버킷·토큰 만드는 방법이 있습니다.)"
  exit 1
fi
chmod 600 "$BACKUP_ENV"

echo "=== 3/4: 백업 1회 실제 실행(검증) ==="
if ! APP_DIR="$APP_DIR" BACKUP_ENV="$BACKUP_ENV" "$BACKUP_SCRIPT"; then
  echo "!! 테스트 백업 실패 — cron을 걸지 않았습니다. 위 에러를 해결한 뒤 다시 실행하세요." >&2
  exit 1
fi

echo "=== 4/4: 매일 cron 등록 ==="
# 서버 시간대가 UTC라고 가정한다: 18:30 UTC = 03:30 KST(치료 시간대 밖).
# 로그는 syslog로: journalctl -t practivetts-backup
sudo tee "$CRON_FILE" >/dev/null <<CRON
# practivetts DB 백업 — 04-backup-setup.sh가 생성. 수정 대신 스크립트를 다시 실행할 것.
30 18 * * * $(whoami) APP_DIR=$APP_DIR BACKUP_ENV=$BACKUP_ENV $BACKUP_SCRIPT 2>&1 | logger -t practivetts-backup
CRON
sudo chmod 644 "$CRON_FILE"
echo "등록됨: $CRON_FILE"
cat "$CRON_FILE"
echo
echo "다음: 복원 리허설 — $APP_DIR/scripts/deploy/restore-check.sh latest"
