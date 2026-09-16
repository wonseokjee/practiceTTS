#!/usr/bin/env bash
# 첫 배포용 서버 프로비저닝 — Vultr 서울 리전 Ubuntu 22.04 LTS 기준.
#
# 사용법 (서버에 SSH 접속 후, sudo 권한 있는 유저로):
#   scp -r scripts/deploy <server-user>@<server-ip>:~/deploy-scripts
#   ssh <server-user>@<server-ip>
#   chmod +x ~/deploy-scripts/*.sh
#   ~/deploy-scripts/01-server-setup.sh
#
# 이 스크립트가 하는 일: OS 업데이트, Node.js 22 LTS, Python3(+venv),
# PostgreSQL, nginx, certbot, pm2(+pm2-logrotate), ufw 방화벽.
# 앱 코드 배포·pm2 기동은 02-app-deploy.sh가 한다(이 스크립트는 런타임만 깐다).
#
# 멱등성: apt/npm install은 이미 설치돼 있으면 그냥 스킵하듯 동작하므로
# 재실행해도 안전하다. 단, ufw enable/postgres 초기화 같은 1회성 단계는
# 이미 된 상태면 각자 알아서 no-op에 가깝게 동작한다(에러는 아님).

set -euo pipefail

echo "=== 1/8: OS 패키지 업데이트 ==="
sudo apt-get update -y
sudo apt-get upgrade -y

echo "=== 2/8: 기본 빌드 도구 ==="
sudo apt-get install -y build-essential curl git ca-certificates gnupg

echo "=== 3/8: Node.js 22 LTS (NodeSource) ==="
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v
npm -v

echo "=== 4/8: pm2 + pm2-logrotate ==="
sudo npm install -g pm2
# DEPLOYMENT.md 「로그 — pm2-logrotate」 절과 동일 설정. AllExceptionsFilter가
# 4xx/5xx를 계속 로그에 남기므로 로테이션 없으면 디스크가 찬다.
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true

echo "=== 5/8: Python3 + venv (ai-service용) ==="
sudo apt-get install -y python3 python3-venv python3-pip
python3 --version

echo "=== 6/8: PostgreSQL ==="
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
echo "PostgreSQL 기동됨. DB·유저 생성은 02-app-deploy.sh 또는 수동으로:"
echo "  sudo -u postgres psql -c \"CREATE USER practivetts WITH PASSWORD '<비밀번호>';\""
echo "  sudo -u postgres psql -c \"CREATE DATABASE practivetts OWNER practivetts;\""

echo "=== 7/8: nginx + certbot ==="
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo systemctl enable nginx
sudo systemctl start nginx

echo "=== 8/8: 방화벽(ufw) — 80/443/SSH만 연다 ==="
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status

cat <<'EOF'

=== 서버 런타임 설치 완료 ===

다음 단계:
  1. nginx-practivetts.conf.template의 {{APP_DOMAIN}}/{{API_DOMAIN}}을
     실제 도메인으로 바꿔 /etc/nginx/sites-available/practivetts로 복사
     (자세한 절차는 이 폴더의 03-nginx-and-tls.sh 참고)
  2. 02-app-deploy.sh로 앱 코드 배포 + 마이그레이션 + pm2 기동
  3. DEPLOYMENT.md의 "배포 전 확인"·"스모크 체크리스트" 절 그대로 수행
EOF
