#!/usr/bin/env bash
# nginx 설정 설치 + certbot으로 HTTPS 발급.
#
# 전제: DNS에서 두 도메인 모두 A 레코드로 이 서버 IP를 이미 가리키고 있을 것
# (certbot의 HTTP-01 챌린지가 실패하면 십중팔구 DNS가 아직 전파 안 된 것).
#
# 사용법:
#   ~/deploy-scripts/03-nginx-and-tls.sh app.example.com api.example.com

set -euo pipefail

APP_DOMAIN="${1:?사용법: 03-nginx-and-tls.sh <app-domain> <api-domain>}"
API_DOMAIN="${2:?사용법: 03-nginx-and-tls.sh <app-domain> <api-domain>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 도메인 인자는 bare domain이어야 한다(스킴·경로 없이). https:// 를 붙여
# 넣으면 아래 sed의 / 구분자와 충돌해 알아보기 힘든 에러로 죽는다 — 여기서
# 먼저 명확하게 막는다.
for domain in "$APP_DOMAIN" "$API_DOMAIN"; do
  case "$domain" in
    */*|*:*)
      echo "도메인 인자에 '/' 또는 ':'가 포함되어 있습니다: $domain" >&2
      echo "스킴(https://)·경로 없이 bare domain만 넘기세요. 예: app.example.com" >&2
      exit 1
      ;;
  esac
done

echo "=== nginx 설정 생성 (${APP_DOMAIN} / ${API_DOMAIN}) ==="
sed \
  -e "s/{{APP_DOMAIN}}/${APP_DOMAIN}/g" \
  -e "s/{{API_DOMAIN}}/${API_DOMAIN}/g" \
  "$SCRIPT_DIR/nginx-practivetts.conf.template" \
  | sudo tee /etc/nginx/sites-available/practivetts >/dev/null

sudo ln -sf /etc/nginx/sites-available/practivetts /etc/nginx/sites-enabled/practivetts
sudo nginx -t
sudo systemctl reload nginx

echo "=== certbot으로 HTTPS 발급 ==="
sudo certbot --nginx -d "$APP_DOMAIN" -d "$API_DOMAIN" --redirect

echo "=== 인증서 자동 갱신 검증 ==="
# 발급은 성공해도 갱신은 90일 뒤에야 처음 돌아서, 실패(80 포트 차단·nginx 설정
# 문제 등)를 그때까지 아무도 모른다. 지금 스테이징 서버로 갱신 전 과정을 시험한다.
if ! sudo certbot renew --dry-run; then
  echo "!! certbot 갱신 dry-run 실패 — 90일 뒤 인증서가 만료됩니다. 위 에러를 먼저 해결하세요." >&2
  exit 1
fi
# 갱신을 주기적으로 실행하는 타이머가 실제로 살아 있는지도 확인한다.
if ! systemctl is-active --quiet certbot.timer; then
  echo "!! certbot.timer가 비활성 상태입니다. 'sudo systemctl enable --now certbot.timer' 후 다시 확인하세요." >&2
  exit 1
fi

echo "=== 완료 ==="
echo "https://${APP_DOMAIN} / https://${API_DOMAIN} 확인해볼 것."
echo "certbot 갱신 dry-run 통과 + certbot.timer 활성 확인됨."
