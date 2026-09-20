#!/usr/bin/env bash
# 02-app-deploy.sh 치료 시간대 가드 테스트. 실행: bash scripts/deploy/02-app-deploy.window.test.sh
# 인자 없이 호출하므로 통과 케이스는 사용법 오류에서 멈춘다(= 가드를 지나 다음 단계에 도달했다는 증거).
# 어느 케이스도 git·빌드·pm2에 닿지 않는다.
set -u
SCRIPT="$(dirname "$0")/02-app-deploy.sh"
FAIL=0

# check <이름> <기대 종료코드> <기대 메시지 조각> <환경변수들...> -- <스크립트 인자들...>
check() {
  local name="$1" want_code="$2" want_msg="$3"; shift 3
  local envs=() args=()
  while [ "$1" != "--" ]; do envs+=("$1"); shift; done; shift
  args=("$@")
  local out code
  out=$(env "${envs[@]}" bash "$SCRIPT" "${args[@]+"${args[@]}"}" 2>&1); code=$?
  if [ "$code" -eq "$want_code" ] && [[ "$out" == *"$want_msg"* ]]; then
    echo "ok   - $name"
  else
    echo "FAIL - $name (code=$code, want=$want_code, msg 조각='$want_msg')"; echo "$out" | sed 's/^/       /'
    FAIL=1
  fi
}

check "낮 10시는 막는다"            1 "치료 시간대" DEPLOY_NOW_HOUR=10 --
check "09시 정각은 막는다(시작 포함)" 1 "치료 시간대" DEPLOY_NOW_HOUR=09 --
check "20시는 막는다"               1 "치료 시간대" DEPLOY_NOW_HOUR=20 --
check "21시 정각은 통과(끝 제외)"    1 "사용법"     DEPLOY_NOW_HOUR=21 --
check "08시는 통과"                 1 "사용법"     DEPLOY_NOW_HOUR=08 --
check "새벽 3시는 통과"             1 "사용법"     DEPLOY_NOW_HOUR=3 --
check "--force는 낮에도 통과+경고"   1 "--force로 진행" DEPLOY_NOW_HOUR=10 -- --force
check "창 환경변수로 조정된다"       1 "사용법"     DEPLOY_NOW_HOUR=10 DEPLOY_WINDOW_START=11 DEPLOY_WINDOW_END=12 --

exit "$FAIL"
