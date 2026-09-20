#!/usr/bin/env bash
# 배포 스크립트 회귀 테스트.
#
# 실제 pg_dump/aws/sudo 없이 스텁(PATH 앞에 끼운 가짜 실행 파일)으로 백업·설치·복원
# 스크립트의 성공/실패 분기를 검증한다. 백업은 깨져도 조용히 안 도는 종류라 서버에서
# 처음 돌기 전에 여기서 실패 분기를 잡아야 한다.
#
# 실행: bash scripts/deploy/tests/deploy-scripts.test.sh   (리포 어디서든)
# 종료 코드: 실패한 검사가 있으면 1.
#
# 범위: backup-db.sh, 04-backup-setup.sh, restore-check.sh, 02의 pm2 startup 검증 블록,
# ecosystem.config.cjs의 ai-service 바인딩. (01·03은 실제 apt/certbot/nginx가 필요해 제외.)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$HERE/.." && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# 스크립트의 mktemp가 이 테스트 전용 디렉터리만 쓰게 한다 — 시스템 /tmp에 남은 파일이
# "임시 파일 정리" 검사를 오염시키지 않도록.
export TMPDIR="$WORK/tmp"
mkdir -p "$TMPDIR"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  ok   $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
# check <설명> <명령...> — 명령이 성공(0)이면 통과
check() { local d="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$d"; else fail "$d"; fi; }
has() { grep -qF -- "$2" "$1" 2>/dev/null; } # has <파일> <문자열>

# ── 스텁 ────────────────────────────────────────────────────────
# 스텁은 이 파일 밖 명령 대체용이라, 필요한 경로는 환경변수(STUB_*)로 받는다.
BIN="$WORK/bin"
mkdir -p "$BIN"
export STUB_CALLS="$WORK/calls.log"
export STUB_PGENV="$WORK/pgdump.env"
export STUB_UNIT="$WORK/unit-enabled"

cat > "$BIN/pg_dump" <<'STUB'
#!/usr/bin/env bash
[ "${FAIL_DUMP:-}" = 1 ] && { echo "dump boom" >&2; exit 1; }
echo "PGHOST=$PGHOST PGPORT=$PGPORT PGUSER=$PGUSER PGPASSWORD=$PGPASSWORD DB=${!#}" > "$STUB_PGENV"
for a in "$@"; do case $a in --file=*) echo DUMP > "${a#--file=}";; esac; done
STUB
cat > "$BIN/pg_restore" <<'STUB'
#!/usr/bin/env bash
[ "${FAIL_LIST:-}" = 1 ] && { echo corrupt >&2; exit 1; }
cat > /dev/null
echo "pg_restore $*" >> "$STUB_CALLS"
STUB
cat > "$BIN/aws" <<'STUB'
#!/usr/bin/env bash
if [ "$2" = ls ]; then
  printf '2026-09-18 03:30:00 1 practivetts-20260918T183000Z.dump\n2026-09-19 03:30:00 1 practivetts-20260919T183000Z.dump\n'
  exit 0
fi
echo "aws $* | key=$AWS_ACCESS_KEY_ID region=$AWS_DEFAULT_REGION" >> "$STUB_CALLS"
# s3 cp s3://... <local> (복원 다운로드)이면 로컬 파일을 만들어 준다
if [ "$1 $2" = "s3 cp" ] && [ "${3:0:5}" = "s3://" ]; then echo data > "$4"; fi
exit 0
STUB
cat > "$BIN/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_CALLS"
STUB
cat > "$BIN/sudo" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = "-u" ]; then shift 2; fi
case "$1" in
  apt-get) echo "[apt-get $*]" ;;
  chmod) : ;;
  env) [ "${STARTUP_ENABLES:-}" = yes ] && touch "$STUB_UNIT"; exit 0 ;; # sudo env PATH=… pm2 startup …
  *) "$@" ;;
esac
STUB
for c in dropdb createdb; do
  printf '#!/usr/bin/env bash\necho "%s $*" >> "$STUB_CALLS"\n' "$c" > "$BIN/$c"
done
cat > "$BIN/psql" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *information_schema*) echo "${TABLES:-12}" ;;
  *users*) echo 34 ;;
esac
STUB
cat > "$BIN/systemctl" <<'STUB'
#!/usr/bin/env bash
[ "${UNIT_STATE:-}" = enabled ] || [ -f "$STUB_UNIT" ]
STUB
printf '#!/usr/bin/env bash\necho tester\n' > "$BIN/whoami"
printf '#!/usr/bin/env bash\nexit 0\n' > "$BIN/pm2"
chmod +x "$BIN"/*
export PATH="$BIN:$PATH"

# ── 픽스처 ─────────────────────────────────────────────────────
APP="$WORK/app"
mkdir -p "$APP/backend" "$APP/scripts/deploy"
cp "$DEPLOY_DIR/backup-db.sh" "$APP/scripts/deploy/"
write_backend_env() { printf '%s\n' "$@" > "$APP/backend/.env"; }
write_backend_env 'DB_HOST=db.internal' 'DB_PORT=5433' 'DB_USERNAME=practivetts' \
  'DB_PASSWORD="p@ss word#1"' 'DB_DATABASE=practivetts'
BK_ENV="$WORK/backup.env"
write_backup_env() { # <핑 URL>
  printf '%s\n' 'BACKUP_R2_ACCOUNT_ID=acc1' 'BACKUP_R2_ACCESS_KEY_ID=kid' \
    'BACKUP_R2_SECRET_ACCESS_KEY=sec' 'BACKUP_R2_BUCKET=bk-bucket' "BACKUP_PING_URL=$1" > "$BK_ENV"
}
write_backup_env 'https://ping.example/x'

OUT="$WORK/out.log"
RC=0
run() { : > "$STUB_CALLS"; RC=0; "$@" > "$OUT" 2>&1 || RC=$?; } # 결과: $RC, $OUT, $STUB_CALLS
run_backup() { run env APP_DIR="$APP" BACKUP_ENV="${BK_ENV_OVERRIDE:-$BK_ENV}" bash "$DEPLOY_DIR/backup-db.sh"; }
rc_is() { [ "$RC" = "$1" ]; }
rc_not() { [ "$RC" != "$1" ]; }
no_calls() { ! grep -qE 'aws|curl' "$STUB_CALLS"; }
no_tmp_left() { ! ls "$TMPDIR"/practivetts-backup.* >/dev/null 2>&1; }

# ── backup-db.sh ───────────────────────────────────────────────
echo "backup-db.sh"
run_backup
check "정상: 종료 0" rc_is 0
check "정상: R2 백업 버킷의 daily/ 키에 업로드" grep -qE 's3://bk-bucket/daily/practivetts-[0-9TZ]+\.dump' "$STUB_CALLS"
check "정상: R2 엔드포인트·auto 리전·전용 토큰 사용" grep -q 'https://acc1.r2.cloudflarestorage.com.*key=kid region=auto' "$STUB_CALLS"
check "정상: 성공 뒤 핑 전송" has "$STUB_CALLS" 'curl -fsS -m 10 --retry 3 https://ping.example/x'
check "DB 접속: .env 값 그대로(공백·# 포함 비밀번호 포함)" has "$STUB_PGENV" 'PGHOST=db.internal PGPORT=5433 PGUSER=practivetts PGPASSWORD=p@ss word#1 DB=practivetts'
check "임시 덤프 파일 정리" no_tmp_left

FAIL_DUMP=1 run_backup
check "pg_dump 실패: 종료 ≠ 0" rc_not 0
check "pg_dump 실패: 업로드도 핑도 없음" no_calls

FAIL_LIST=1 run_backup
check "잘린 덤프(pg_restore --list 실패): 종료 ≠ 0" rc_not 0
check "잘린 덤프: 업로드도 핑도 없음" no_calls

sed 's/BACKUP_R2_BUCKET=.*/BACKUP_R2_BUCKET=/' "$BK_ENV" > "$WORK/empty-bucket.env"
BK_ENV_OVERRIDE="$WORK/empty-bucket.env" run_backup
check "빈 버킷 설정: 종료 ≠ 0" rc_not 0
check "빈 버킷 설정: 어떤 키가 비었는지 알려줌" has "$OUT" 'BACKUP_R2_BUCKET'

write_backend_env 'DB_HOST=' 'DB_PORT=' 'DB_USERNAME=' 'DB_PASSWORD=pw' 'DB_DATABASE='
run_backup
check "DB_* 비어 있음: 앱 기본값(localhost/5432/postgres/memorylink)으로 접속" has "$STUB_PGENV" 'PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=pw DB=memorylink'
check "DB_* 비어 있음: 백업 성공" rc_is 0
write_backend_env 'DB_PASSWORD=pw'
run_backup
check "DB_* 키 자체가 없음: 소리 없이 죽지 않고 기본값으로 성공" rc_is 0

# ── 04-backup-setup.sh ─────────────────────────────────────────
echo "04-backup-setup.sh"
write_backend_env 'DB_HOST=db.internal' 'DB_USERNAME=u' 'DB_PASSWORD=pw' 'DB_DATABASE=d'
HOME_T="$WORK/home"
CRON_T="$WORK/cronfile"
run_setup() { rm -f "$CRON_T"; run env HOME="$HOME_T" APP_DIR="$APP" CRON_FILE="$CRON_T" "$@" bash "$DEPLOY_DIR/04-backup-setup.sh"; }
no_cron() { [ ! -f "$CRON_T" ]; }
cron_has() { grep -qE "$1" "$CRON_T" 2>/dev/null; }
set_home_env() { write_backup_env "$1"; mkdir -p "$HOME_T"; cp "$BK_ENV" "$HOME_T/.practivetts-backup.env"; }

rm -rf "$HOME_T"; mkdir -p "$HOME_T"
run_setup
check "설정 파일 없음: 종료 ≠ 0" rc_not 0
check "설정 파일 없음: 양식을 만들어 줌" test -f "$HOME_T/.practivetts-backup.env"
check "설정 파일 없음: cron 없음" no_cron

run_setup # 방금 만든 빈 양식 그대로
check "값 비어 있음: 종료 ≠ 0, cron 없음" bash -c "[ $RC != 0 ] && [ ! -f '$CRON_T' ]"

set_home_env ''
run_setup
check "핑 URL 비어 있음: 종료 ≠ 0" rc_not 0
check "핑 URL 비어 있음: 이유를 알려줌" has "$OUT" 'BACKUP_PING_URL'
check "핑 URL 비어 있음: cron 없음" no_cron
check "핑 URL 비어 있음: 테스트 백업 시도 전에 멈춤" no_calls

set_home_env 'https://ping.example/x'
FAIL_DUMP=1 run_setup
check "테스트 백업 실패: 종료 ≠ 0" rc_not 0
check "테스트 백업 실패: cron 없음" no_cron

run_setup TZ=UTC0
check "정상(서버 UTC): 종료 0" rc_is 0
check "정상(서버 UTC): KST 03:30 = 18:30 UTC로 등록" cron_has '^30 18 \* \* \* '
check "cron 줄이 스크립트 실행과 logger 파이프를 포함" cron_has 'backup-db\.sh 2>&1 \| logger -t practivetts-backup'
run_setup TZ=KST-9
check "정상(서버 KST): 03:30으로 등록(낮에 돌지 않음)" cron_has '^30 3 \* \* \* '
run_setup TZ=EST5
check "정상(서버 UTC-5): 13:30으로 등록" cron_has '^30 13 \* \* \* '

# ── restore-check.sh ───────────────────────────────────────────
echo "restore-check.sh"
run_restore() { run env HOME="$HOME_T" bash "$DEPLOY_DIR/restore-check.sh" "$@"; }
run_restore latest
check "latest: 사전순 마지막(최신) 백업을 받는다" has "$STUB_CALLS" 'practivetts-20260919T183000Z.dump'
check "latest: 성공 + 테이블·users 수 출력" has "$OUT" '테이블 12개, users 34행'
check "복원은 임시 DB로만 한다" has "$STUB_CALLS" 'pg_restore --no-owner --dbname=practivetts_restore_check'
check "끝나면 임시 DB를 지운다" has "$STUB_CALLS" 'dropdb --if-exists practivetts_restore_check'
TABLES=0 run_restore latest
check "테이블 0개(빈 백업): 종료 ≠ 0" rc_not 0
check "테이블 0개: '복원 성공'을 찍지 않음" bash -c "! grep -q '복원 성공' '$OUT'"

# ── 02의 pm2 startup 검증 블록 ─────────────────────────────────
echo "02-app-deploy.sh (pm2 startup 블록)"
sed -n '/^PM2_UNIT=/,/^echo "재부팅 자동 기동 확인됨/p' "$DEPLOY_DIR/02-app-deploy.sh" | sed '$d' > "$WORK/pm2block.sh"
echo 'echo BLOCK_PASS' >> "$WORK/pm2block.sh"
run_block() { rm -f "$STUB_UNIT"; run bash -c "set -euo pipefail; source '$WORK/pm2block.sh'"; }
UNIT_STATE=enabled run_block
check "이미 활성: 통과" bash -c "[ $RC = 0 ] && grep -q BLOCK_PASS '$OUT'"
STARTUP_ENABLES=yes run_block
check "미활성 → startup 실행으로 활성화: 통과" bash -c "[ $RC = 0 ] && grep -q BLOCK_PASS '$OUT'"
STARTUP_ENABLES=no run_block
check "startup을 해도 미활성: 종료 ≠ 0(리부팅 시 앱 미기동을 배포 때 잡음)" bash -c "[ $RC != 0 ] && ! grep -q BLOCK_PASS '$OUT'"

# ── ecosystem.config.cjs ───────────────────────────────────────
echo "ecosystem.config.cjs"
AI_ARGS="$(cd "$REPO_DIR" && node -e "console.log(require('./ecosystem.config.cjs').apps.find(a=>a.name==='practivetts-ai').args)" 2>/dev/null)"
check "ai-service는 127.0.0.1에 바인딩" bash -c "[[ '$AI_ARGS' == *'--host 127.0.0.1'* ]]"
check "ai-service는 0.0.0.0에 바인딩하지 않음" bash -c "[[ '$AI_ARGS' != *'0.0.0.0'* ]]"

echo
echo "통과 $PASS / 실패 $FAIL"
[ "$FAIL" -eq 0 ]
