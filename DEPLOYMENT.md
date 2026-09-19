# 배포

## 첫 배포 — 서버 프로비저닝 스크립트

Vultr(서울) 같은 빈 Ubuntu 22.04 VPS에 처음 올릴 때는 `scripts/deploy/`의
스크립트를 순서대로 실행한다:

1. `01-server-setup.sh` — swap 2GB, Node.js 22·Python3·PostgreSQL·nginx·certbot·pm2
   설치, 방화벽(ufw) 설정 (서버에서 1회). 2GB 램에 pm2 한도(backend 512M +
   ai-service 768M)·PostgreSQL·빌드가 겹치므로 swap이 피크를 흡수한다.
2. `03-nginx-and-tls.sh <app-domain> <api-domain>` — nginx 설정 + HTTPS
   발급 + `certbot renew --dry-run`/`certbot.timer` 확인(실패하면 종료).
   프론트(`VITE_API_URL`)와 백엔드를 서브도메인으로 분리한다 — 백엔드
   라우트가 `/api` 같은 prefix 없이 루트에 바로 걸려 있어 경로 기반 분기보다
   간단하다.
3. `02-app-deploy.sh <git-repo-url> [branch]` — 코드 클론/풀, 빌드,
   마이그레이션, pm2 기동, `pm2 save` + `pm2 startup`(재부팅 자동 기동,
   활성 검증 실패 시 종료). `.env` 3개(backend/ai-service/frontend)는 이
   스크립트가 만들지 않으므로 `.env.example`을 참고해 서버에서 직접 채워야
   한다. 재배포할 때도 이 스크립트를 다시 실행하면 된다(pm2가 있으면
   reload, 없으면 최초 기동).
4. `04-backup-setup.sh` — DB 백업 설치(아래 「DB 백업·복원」). 02 뒤에 실행.

스크립트 모두 아래 "배포 전 확인"·"스모크 체크리스트"를 대체하지 않는다
— 런타임·앱 배치만 자동화할 뿐, 실제로 도는지 확인하는 건 여전히 사람이 한다.

## 현재 전제: 단일 인스턴스

이 앱은 **인스턴스 하나**로 도는 것을 전제로 만들어져 있다. 성능이 부족해서가
아니라, 다중 인스턴스를 지탱할 공유 상태 인프라가 아직 없기 때문이다.

작업 부하가 거의 전부 외부 API 대기(Gemini 수 초, Azure 수백 ms)라 CPU가
아니라 I/O가 지배한다. Node.js 단일 프로세스는 이런 대기를 수천 건 동시에
처리하므로, 인스턴스를 늘려 얻을 처리량은 현재 사용 규모에서 필요하지 않다.

단일 인스턴스의 실제 대가는 처리량이 아니라 **가용성**이다.

- 배포할 때마다 다운타임이 생긴다
- 프로세스가 죽으면 전면 중단이다
- 재시작하면 레이트리밋 카운터가 초기화된다

치료 시간이 정해진 임상 도구라면 그 시간을 피해 배포하는 것으로 충분할 수
있다. 24시간 접근이 필요해지면 다중 인스턴스가 필요한데, 그 이유는 처리량이
아니라 **무중단**이다.

## 다중 인스턴스로 띄우면 깨지는 것

부팅은 멀쩡히 성공한다. 깨지는 건 런타임이고, 조용히 깨진다.

| # | 문제 | 증상 | 심각도 |
|---|---|---|---|
| 1 | 업로드 사진이 인스턴스별 로컬 디스크 | 새로고침마다 사진이 보였다 안 보였다 (404) | **기능 파손** |
| 2 | TTS 캐시도 로컬 디스크 | 인스턴스 수만큼 Azure 중복 호출 | 비용 |
| 3 | 레이트리밋이 프로세스 메모리 | 실효 한도가 인스턴스 수만큼 곱해짐 | 보호 약화 |
| 4 | 퀴즈 복구 claim이 배타 리스가 아님 | 같은 세트를 동시 생성해 문항이 두 배 | 기능 파손 + 비용 |

`entity_map`(마스킹 매핑)이 인메모리인 것은 **문제가 아니다.** 코드를 확인한
결과 아무도 읽지 않는다(`_store.get()` 호출처가 저장소 자신뿐). 페르소나 토큰
복원은 백엔드가 DB 프로필에서 하므로 무상태다.

## 보호 장치

두 겹이다.

1. **`ecosystem.config.cjs`** — `instances: 1`, `exec_mode: 'fork'`, uvicorn
   `--workers 1`. 이유가 주석으로 붙어 있다.
2. **`SingleInstanceGuard`** (backend) — Postgres 세션 advisory lock으로 다른
   인스턴스가 살아 있는지 **실제로** 확인한다. 배포 플랫폼에 의존하지 않으므로
   설정 파일을 우회해 띄워도 동작한다.

기본은 경고다. 롤링 배포 중에는 잠깐 두 인스턴스가 겹치는 게 정상이라, 그때마다
기동을 막으면 배포가 불가능해진다. 확실히 막으려면:

```
ENFORCE_SINGLE_INSTANCE=true
```

## 다중 인스턴스 전환 순서

**가드를 끄기 전에** 아래를 끝낼 것. 가드만 끄면 위 네 가지가 그대로 발생한다.

비용 대비 효과 순서다.

### 1. 사진 → 오브젝트 스토리지 (필수, 가장 큼)

로컬 디스크 의존을 없앤다. 백업·CDN도 같이 해결된다.

- 바꿀 곳: `backend/src/memory/services/file-storage.service.ts`
  (파일 상단 주석이 이미 "S3로 교체 시 이 클래스만 교체"라고 밝히고 있다)
- `MemoryPhotoController`는 그대로 둔다 — 소유권 검사는 스토리지와 무관하다.
  스토리지가 서명 URL을 준다면 짧은 만료(수 분)로 발급하고, **URL 자체가
  접근 통제가 되지 않게** 소유권 검사를 먼저 통과시킬 것.
- `UPLOAD_DIR`는 로컬 개발용으로만 남긴다.

### 2. 레이트리밋 → Redis (필수)

- 바꿀 곳: `backend/src/common/sliding-window-rate-limiter.ts`,
  `ai-service/infra/rate_limiter.py`
- 두 곳 다 인터페이스가 분리돼 있어 구현만 갈아끼우면 된다.
- ai-service 쪽은 **사용자별이 아니라 전역 회로차단기**다(프록시 뒤라 IP가
  전부 백엔드 하나). 이 성격을 유지할 것 — 자세한 건 `.env.example` 주석 참고.

### 3. 퀴즈 claim → DB 배타 리스 (필수)

현재는 CAS 1회일 뿐 상호배제가 아니다. 시차를 두고 스캔하는 두 워커를 막지
못한다.

- `quiz_sets`에 `generating` 상태와 `generation_lease_until TIMESTAMPTZ` 추가
- claim을 다음 형태로:
  ```sql
  UPDATE quiz_sets
     SET generation_status = 'generating',
         generation_lease_until = now() + interval '10 minutes',
         generation_attempts = generation_attempts + 1
   WHERE id = $1
     AND (generation_status IN ('pending','failed')
          OR generation_lease_until < now())
  ```
- 최후 방어선으로 `quiz_questions(quiz_set_id, order_index)` UNIQUE 인덱스를
  걸어 중복 저장을 DB가 막게 한다.

### 4. TTS 캐시 → 공유 스토리지 (선택)

안 해도 깨지지는 않는다. 비용만 인스턴스 수만큼 늘어난다. 1번에서 오브젝트
스토리지를 붙였다면 같은 방식으로 옮기면 된다.

### 마지막

위 1~3을 끝낸 뒤:

- `ecosystem.config.cjs`의 `instances`를 올리고 주석을 갱신한다
- `SingleInstanceGuard`를 `AppModule` providers에서 제거한다
- 이 문서의 "현재 전제"를 갱신한다

## DB 백업·복원

환자 회복 이력이 단일 VPS의 단일 디스크에만 있으므로 백업이 없으면 디스크
장애 한 번에 전손이다. `04-backup-setup.sh`가 매일 03:30 KST에
`backup-db.sh`(`pg_dump` → `pg_restore --list` 무결성 확인 → R2 업로드)를 cron에
건다. 절차:

1. **Cloudflare R2에 백업 전용 버킷** 생성(사진 버킷과 별개, 비공개).
2. 그 버킷 하나에만 **Object Read & Write** 권한을 가진 **전용 API 토큰** 발급.
   사진 버킷 키를 재사용하지 말 것 — 키 하나가 새거나 잘못 지워도 사진과
   백업이 같이 날아가면 안 된다.
3. 버킷 **Settings → Object lifecycle rules**에서 `daily/` 접두사 14일 뒤 삭제
   (스크립트는 지우지 않는다).
4. 선택: healthchecks.io 같은 "핑이 끊기면 알림" 서비스에 체크를 만들고 그 URL을
   `BACKUP_PING_URL`에 넣는다 — cron이 조용히 죽는 것을 잡는 유일한 장치다.
5. `04-backup-setup.sh`를 실행하면 `~/.practivetts-backup.env` 양식을 만들고
   멈춘다. 값을 채워 **다시 실행**하면 테스트 백업 1회가 통과했을 때만 cron이
   등록된다. 로그: `journalctl -t practivetts-backup`.

**복원 리허설을 반드시 한 번 한다** — 백업은 복원돼 봐야 백업이다:

```bash
/opt/practivetts/scripts/deploy/restore-check.sh latest
```

임시 DB(`practivetts_restore_check`)에 복원해 테이블 수와 `users` 행 수를 출력하고
지운다(운영 DB는 건드리지 않는다). 실제 장애 복원은 같은 덤프를 새 DB에
`pg_restore --no-owner --dbname=<DB>`로 넣는다.

⚠️ 덤프에는 **암호화된 가족 실명**이 들어 있다. `CRYPTO_SECRET_KEY`가 없으면
백업만 있어도 복호화할 수 없다 — 아래 「시크릿 보관」.

## 시크릿 보관

`.env` 세 개(backend/ai-service/frontend)는 서버 한 대에만 있으면 서버와 함께
사라진다. 특히 `CRYPTO_SECRET_KEY`를 잃으면 저장된 가족 실명을 **영구히**
복호화할 수 없다.

- 배포 직후 `.env` 세 개의 값을 **비밀번호 관리자**(1Password/Bitwarden 등)에
  옮겨 둔다. R2 사진 키·`~/.practivetts-backup.env`의 백업 토큰도 같이.
- **백업(pg_dump)과 다른 곳에 둔다.** 덤프와 키가 같은 저장소에 있으면 그
  저장소가 유출될 때 실명이 한 번에 열린다.
- 키를 바꾸는 일은 없다(바꾸면 기존 데이터 복호화 불가).

## 가동 감시

pm2가 재시작 한도(`max_restarts: 10`)를 넘겨 포기하면 nginx가 조용히 502를 낸다 —
아무도 모른다. 무료 외부 감시를 건다:

- UptimeRobot(또는 동급)에서 `https://api.<domain>/health` **HTTP 모니터**, 5분 간격,
  이메일 알림. 이 경로는 인증 없이 열려 있고, DB에 `SELECT 1`이 통하면 200
  `{"status":"ok"}`, 실패하거나 3초 안에 응답이 없으면 503을 준다. 확인은 앱과 같은
  커넥션 풀을 타므로 **느린 쿼리로 풀이 꽉 차도 503이다** — 사용자가 실제로 막히는
  상태라 의도한 동작이다. 결과는 3초간 재사용되고 동시에 오는 요청은 확인 하나를
  공유한다. 503의 원인(연결 거부·인증 실패·타임아웃)은 응답이 아니라
  `pm2 logs`의 `health DB check failed: …` 줄에서 본다.
- `GET /`(`Hello World!`)는 프로세스 생존만 본다 — DB가 죽어도 200이라 감시 대상으로
  쓰지 않는다.
- ai-service는 외부로 열려 있지 않아(nginx가 프록시하지 않음) 이 감시가 보지 못한다.
  백엔드가 AI 호출에 실패하면 로그(`pm2 logs`)로 드러난다.
- 인증서 만료 알림은 UptimeRobot의 SSL 만료 알림을 켠다(갱신은 03이 dry-run으로
  검증하지만 이중 안전장치).

## 로그 — pm2-logrotate

`AllExceptionsFilter`(backend)가 4xx·5xx를 서버 로그에 남긴다(계획 §13 8-1) —
QAB 저장 실패 같은 것이 지금까지는 환자 기기 콘솔에만 남아 운영자가 몰랐다.
문제는 pm2 기본 설정이 로그를 무제한으로 쌓는다는 것이다: 파일이 디스크를
채우면 새 로그도, 무관한 다른 쓰기(사진 업로드·DB)도 함께 실패한다. 이
전역 필터가 로그를 늘리는 만큼, 로테이션은 배포와 한 세트다.

**서버에서 최초 1회만** 실행한다(이 저장소의 npm 패키지가 아니라 pm2 모듈이다):

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

- `max_size 10M`: 파일 하나가 이 크기를 넘으면 회전한다.
- `retain 14`: 회전된 파일을 14개(대략 2주치, 트래픽에 따라 다름)까지만
  보관하고 그 전 것은 지운다.
- `compress true`: 회전된 파일을 gzip으로 압축해 보관 용량을 줄인다.
- 확인: `pm2 conf pm2-logrotate` — 설정이 반영됐는지, `pm2 logs`로 로그가
  실제로 쌓이는지.

## 배포 순서 — 하위 호환 없는 변경 (2단 배포)

**문제(계획 §13 9-1).** API 계약이 바뀌는 배포에 정해진 순서가 없었다. 서버와
클라이언트를 한 번에 같이 올릴 수 없다 — 무중단 배포에서도, 롤백에서도 잠깐은
구버전과 신버전이 섞여 돈다(§ "현재 전제: 단일 인스턴스" 참고). 신버전 프론트가
구버전 백엔드를 잠깐이라도 부르면 그 요청은 실패해야 하는데, 순서를 안 정해두면
그게 "가끔 나는 에러"로만 보인다.

**원칙.** 필드를 늘리는 변경은 **서버 먼저, 클라이언트 나중**이다. 서버가 새
필드를 "있으면 받고 없으면 기존대로"로 먼저 배포되면, 그 사이 잠깐 도는 구버전
프론트도 여전히 정상 동작한다. 필드를 없애는 변경은 반대로 **클라이언트가
먼저 안 보내게 하고, 그 다음 서버가 안 받아도 되게** 한다.

```
정방향  1단계: migration:run ─▶ 백엔드 배포(새 필드는 optional, 안 와도 기존대로) ─▶ 스모크
        2단계: 프론트 배포(새 필드를 보내기 시작) ─▶ 스모크
롤백    프론트 되돌림(안 보내던 대로) ─▶ 백엔드 되돌림 ─▶ migration:revert   ← 정방향의 역순
```

각 단계 뒤에 스모크를 반드시 돌린다 — 다음 단계로 넘어가기 전에 지금 단계가
실제로 동작하는지 확인하지 않으면, 2단계가 깨졌을 때 1단계까지 원인을 좁히는
데 시간이 걸린다.

**실제 사례 — `answeredAt`/`locale` 롤아웃(OV-B, M27~M28).** 이 패턴을 만든
계기다.

| 단계 | PR | 내용 | 상태 |
|---|---|---|---|
| migration | #167 | `qab_results.answered_at` 컬럼 추가(NULL 허용) | main 병합 |
| 1단계(백엔드) | #169 | DTO에 `answeredAt` 선택 필드 추가. 안 오면 서버 시각 사용 — 구버전 프론트도 그대로 동작 | main 병합 |
| 2단계(프론트) | #170 | 결과가 생기는 자리에서 `answeredAt`을 찍어 보내기 시작 | **운영 서버에 #169가 배포된 것을 확인하기 전엔 머지하지 않는다** |

`ValidationPipe`가 `forbidNonWhitelisted: true`(`main.ts`)라서 순서가 특히
중요하다 — 프론트가 백엔드보다 먼저 새 필드를 보내면, 그 필드를 모르는
구버전 백엔드는 요청 자체를 **400으로 거절한다.** "가끔 나는 에러"가 아니라
그 필드를 보내는 모든 요청이 배포 창 동안 전부 실패한다.

## 스모크 체크리스트

배포 각 단계 뒤, 실제 계정으로 딱 한 건만 오가는지 눈으로 확인한다. 자동화된
스크립트를 두지 않은 이유: 운영 자격증명을 리포지토리에 들여오지 않기 위해서다.

```bash
# 1) 로그인 — JWT 확보
curl -s -X POST "$API_BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<스모크용 계정>","password":"<비밀번호>"}' \
  | tee /tmp/login.json
TOKEN=$(node -pe "JSON.parse(require('fs').readFileSync('/tmp/login.json')).accessToken")

# 2) QAB 결과 1건 제출 — 201이 나와야 한다
curl -s -o /tmp/qab.json -w '%{http_code}\n' -X POST "$API_BASE/quiz/qab-results" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "sessionToken":"00000000-0000-4000-8000-000000000001",
    "results":[{"subtest":"word","itemRef":"smoke-check","isCorrect":true}]
  }'
```

- **1단계(백엔드만) 뒤:** 이 curl이 `answeredAt` 필드 **없이** 201을 받는지 —
  구버전 프론트를 흉내낸 것이다.
- **2단계(프론트) 뒤:** 실제 앱에서 문항 하나를 눌러 완료하고, 보호자 화면의
  추이 카드에 방금 그 시도가 반영되는지 — DB까지 실제로 갔는지 확인한다.
- **첫 배포에서만:** ① `sudo reboot` 후 `pm2 status`에 두 프로세스가 자동으로 떠 있는지
  ② `restore-check.sh latest`가 "복원 성공"을 내는지 ③ `free -h`에서 swap 2GB가
  잡혀 있는지(이후 `pm2 monit`으로 실사용량을 보고 `max_memory_restart` 조정).
- 어느 단계든 400/500이면 §"전역 예외 필터" 로그(`pm2 logs practivetts-backend`)에서
  `method·path·status`를 먼저 본다 — 필드명까지는 나오되 값은 안 나온다.

## 배포 전 확인

```bash
# 환경변수 드리프트 (누락·잉여 양방향)
cd backend && npx jest src/common/env-drift.spec.ts
cd ai-service && python -m pytest tests/test_env_drift.py

# 마이그레이션이 빈 DB에서 완주하는지 + 엔티티-스키마 드리프트 0건인지
# (R5: practivetts_test에 새로 만들어 검증한다 — 개발 DB를 손대지 않는다)
cd backend && npm run test:int
```

`CRYPTO_SECRET_KEY`는 32자 이상이어야 하고, `NODE_ENV=production`이면
미설정 시 기동이 중단된다. **이 값을 나중에 바꾸면 이미 저장된 가족 실명을
복호화할 수 없다.**
