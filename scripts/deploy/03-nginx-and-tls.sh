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

echo "=== 완료 ==="
echo "https://${APP_DOMAIN} / https://${API_DOMAIN} 확인해볼 것."
echo "certbot이 갱신 타이머(systemd timer)를 자동 등록한다 — 별도 조치 불필요."
