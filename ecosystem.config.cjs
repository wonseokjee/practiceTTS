/**
 * PM2 배포 설정.
 *
 * ⚠️ instances는 반드시 1이다. 늘리기 전에 DEPLOYMENT.md의 "다중 인스턴스
 * 전환" 절을 먼저 끝낼 것.
 *
 * 이 앱은 단일 인스턴스 전제로 만들어져 있다. 인스턴스를 늘려도 부팅은
 * 멀쩡히 성공하고, 깨지는 건 런타임이며 조용히 깨진다:
 *
 *   1. 업로드 사진이 인스턴스별 로컬 디스크 → 새로고침마다 404가 났다 안 났다
 *   2. TTS 캐시도 로컬 디스크 → 인스턴스 수만큼 Azure 중복 호출(비용)
 *   3. 레이트리밋이 프로세스 메모리 → 실효 한도가 인스턴스 수만큼 곱해짐
 *   4. 퀴즈 복구 claim이 배타 리스가 아님 → 중복 생성으로 문항이 두 배
 *
 * 백엔드의 SingleInstanceGuard가 Postgres advisory lock으로 실제 중복 기동을
 * 감지해 경고한다(ENFORCE_SINGLE_INSTANCE=true면 기동 실패).
 * 이 설정 파일을 우회해 띄워도 그 가드는 동작한다.
 */
module.exports = {
  apps: [
    {
      name: 'practivetts-backend',
      cwd: './backend',
      script: 'dist/main.js',
      // 변경 금지 — 위 주석 참고.
      instances: 1,
      exec_mode: 'fork', // cluster로 바꾸면 위 4가지가 그대로 발생한다.
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '512M',
      // 재시작 시 레이트리밋 카운터가 초기화된다(인메모리). 잦은 재시작은
      // 보호 장치를 무력화하므로, 크래시가 반복되면 원인을 먼저 볼 것.
      min_uptime: '30s',
      max_restarts: 10,
    },
    {
      name: 'practivetts-ai',
      cwd: './ai-service',
      script: 'venv/bin/uvicorn',
      // uvicorn --workers도 같은 이유로 1이어야 한다. TTS 캐시와
      // 레이트리밋이 프로세스 로컬이다.
      args: 'main:app --host 0.0.0.0 --port 8000 --workers 1',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      min_uptime: '30s',
      max_restarts: 10,
    },
  ],
};
