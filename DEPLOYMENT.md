# 배포

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

## 배포 전 확인

```bash
# 환경변수 드리프트 (누락·잉여 양방향)
cd backend && npx jest src/common/env-drift.spec.ts
cd ai-service && python -m pytest tests/test_env_drift.py

# 마이그레이션이 빈 DB에서 완주하는지
cd backend && npm run migration:run

# 엔티티-스키마 드리프트 0건인지
npx typeorm-ts-node-commonjs schema:log -d src/database/data-source.ts
```

`CRYPTO_SECRET_KEY`는 32자 이상이어야 하고, `NODE_ENV=production`이면
미설정 시 기동이 중단된다. **이 값을 나중에 바꾸면 이미 저장된 가족 실명을
복호화할 수 없다.**
