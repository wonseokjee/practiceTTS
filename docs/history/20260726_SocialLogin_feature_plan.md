# 소셜 로그인 (카카오 우선, 구글 확장) — Feature Plan

> 작성일: 2026-07-26
> 작성자: Feature Architect (Claude)
> 적용 범위: 인증에 소셜 로그인 추가 — 카카오 먼저 구현, 구글은 동일 구조로 확장
> 확정 결정: (D-A) OAuth 방식 = **리다이렉트(Passport)** / (D-B) 범위 = **카카오 먼저**, 구글은 같은 틀로 이어붙임 / (D-C) 진행 = **계획 확정 후 구현**

---

## 0. 배경 및 문제

현재 로그인은 **이메일 + 비밀번호**뿐이다([auth.service.ts](../../backend/src/auth/auth.service.ts), [LoginScreen.tsx](../../frontend/src/memory-link/shared/LoginScreen.tsx)). 주 사용자는 **한국의 보호자(어르신 가족)**이고, 이들에게는 새 이메일/비밀번호를 만드는 것보다 **카카오·구글 계정으로 바로 시작**하는 편이 진입 장벽이 훨씬 낮다.

현 인증 구조의 핵심 사실:

- `User`: `email`(고유·**NOT NULL**) + `password_hash`(**NOT NULL**) + `role` + `patient_id` + `patient_mode_pin_hash`
- 회원가입 = **트랜잭션으로 환자 레코드 + 보호자 레코드 동시 생성**. 환자는 placeholder 이메일 + `UNUSABLE_PASSWORD_HASH` 센티널로 로그인 불가 ([auth.service.ts](../../backend/src/auth/auth.service.ts) `register`)
- 로그인은 `UNUSABLE_PASSWORD_HASH` 계정을 bcrypt 비교 전에 **명시적으로 거부**
- JWT payload = `sub`(user id) + `role` + `patientId` → 프론트 `localStorage['ml_token']` ([AuthContext.tsx](../../frontend/src/memory-link/shared/AuthContext.tsx))
- 프론트는 저장 토큰이 있으면 `GET /auth/me`로 사용자 복원

### 소셜 로그인이 현 구조와 부딪히는 지점

1. **비밀번호 없음** — 소셜 유저는 `password_hash`가 없다. → 기존 `UNUSABLE_PASSWORD_HASH` 센티널을 재사용하면 비번 로그인이 자동 차단돼 **깔끔하게 맞물린다**(스키마 변경 없이 재사용).
2. **재방문 유저 매칭** — "이 카카오 계정 = 우리 DB의 어느 user인가"를 알아야 한다. → `auth_provider` + `provider_user_id` 컬럼 필요(마이그레이션).
3. **카카오 이메일이 없을 수 있다** — 카카오는 이메일 제공이 **동의 선택 항목**이라 비어 있을 수 있다. `email`이 NOT NULL·고유라 충돌. → email nullable 전환 + provider 기반 매칭.
4. **어르신 성함·PIN 미수집** — 지금 회원가입은 "어르신 성함 + 4자리 PIN"을 함께 받아 환자 레코드를 만든다. 소셜은 이 값을 안 준다. → **소셜 최초 로그인 후 온보딩 1스텝**에서 받아 환자 레코드를 완성한다.

---

## 1. 개요 및 범위

### 1-1. Deliverable

| # | Deliverable | 계층 | 비고 |
|---|---|---|---|
| D1 | `User`에 `auth_provider`·`provider_user_id` 컬럼, `email`·`password_hash` nullable 전환 + 마이그레이션 | 백엔드 스키마 | §3 |
| D2 | 카카오 앱 키/콜백 URL을 `.env`로 주입(커밋 금지) + 설정 검증 | 백엔드 설정 | §4-1 |
| D3 | `passport-kakao` 전략 + `KakaoAuthGuard` | 백엔드 인증 | §4-2 |
| D4 | `GET /auth/kakao`(인가 시작), `GET /auth/kakao/callback`(콜백→JWT→프론트 리다이렉트) | 백엔드 컨트롤러 | §4-3 |
| D5 | `AuthService.findOrCreateSocialUser()` — provider+id로 조회, 없으면 미완성 소셜 유저 생성 | 백엔드 서비스 | §4-4 |
| D6 | 온보딩 엔드포인트 `POST /auth/complete-onboarding`(어르신 성함 + PIN → 환자 레코드 생성·연결) | 백엔드 컨트롤러 | §4-5 |
| D7 | 콜백 토큰 전달 방식(일회용 코드 교환) + `state` CSRF 방어 | 백엔드 보안 | §6 |
| D8 | 프론트 콜백 라우트 `/auth/callback` — 토큰 수령·저장·`/auth/me` | 프론트 라우팅 | §5-1 |
| D9 | `LoginScreen`에 "카카오로 시작하기" 버튼 | 프론트 UI | §5-2 |
| D10 | 소셜 온보딩 화면(어르신 성함 + PIN) — `needsOnboarding` 유저 라우팅 가드 | 프론트 UI | §5-3 |
| D11 | 백엔드 테스트: findOrCreate 분기, 콜백 JWT, 온보딩, 이메일 없는 카카오 | 테스트 | §7 |
| D12 | 프론트 테스트: 콜백 저장, 온보딩 폼 검증, 로그인 버튼 | 테스트 | §7 |
| D13 | 구글 확장(passport-google-oauth20)을 D3~D10과 동일 틀로 이어붙임 | 후속 | §8 |

### 1-2. 범위 밖 (이번 계획 제외)

- 계정 연동(같은 사람이 이메일+카카오+구글을 한 계정에 병합) — 후속. 이번엔 **provider별 독립 계정**.
- 로그아웃 시 카카오 세션 해제(카카오 로그아웃 API) — 자체 JWT만 폐기.
- 애플 로그인(iOS 배포 시 필요) — 후속.

---

## 2. 결정 사항 (확정)

| ID | 결정 | 근거 |
|---|---|---|
| D-A | **리다이렉트(Passport) 방식** | 시크릿이 서버에만 남고, 표준 검증 경로. SDK 방식보다 프론트가 얇음 |
| D-B | **카카오 먼저**, 구글은 동일 추상 위에 확장 | 한국 유저 주 타깃. 공통 `findOrCreateSocialUser`로 재사용 |
| D-C | **계획 확정 후 구현** | OAuth 앱 키가 있어야 실제 동작 테스트 가능(사용자 준비물, §9) |

---

## 3. 데이터 모델 변경

### 3-1. `User` 엔티티

```ts
// 추가
@Column({ name: 'auth_provider', type: 'varchar', length: 20, default: 'local' })
authProvider: 'local' | 'kakao' | 'google';

// 소셜 제공자가 준 그 계정의 고유 ID(카카오 회원번호 등). 문자열로 저장.
@Column({ name: 'provider_user_id', type: 'varchar', nullable: true })
providerUserId: string | null;

// 변경: 소셜 유저는 이메일/비번이 없을 수 있음
@Column({ unique: true, nullable: true })   // email → nullable
email: string | null;

@Column({ name: 'password_hash', select: false, nullable: true })  // → nullable
passwordHash: string | null;
```

- **매칭 키**: `(auth_provider, provider_user_id)`에 **부분 고유 인덱스**(provider != 'local'일 때). 이메일이 아니라 이걸로 재방문 유저를 찾는다.
- **이메일 고유 제약**: `NULL`은 Postgres에서 고유 제약에 걸리지 않으므로 이메일 없는 카카오 유저 다수 공존 가능. 단, 기존 로컬 계정과의 이메일 충돌은 §4-4에서 처리.
- **하위호환**: 기존 로컬 계정은 `auth_provider='local'`, `provider_user_id=NULL` → 기존 로그인 경로 무변경.

### 3-2. 마이그레이션

- 컬럼 추가(`auth_provider` DEFAULT 'local' → 기존 행 자동 채움), `email`·`password_hash` `DROP NOT NULL`.
- 부분 고유 인덱스: `CREATE UNIQUE INDEX ... ON users(auth_provider, provider_user_id) WHERE provider_user_id IS NOT NULL`.
- **주의(메모리 기록 참조)**: TIMESTAMP↔TIMESTAMPTZ 변환처럼 시간대 문제는 없지만, `DROP NOT NULL`은 되돌리기(`down`)에서 기존 NULL 행이 있으면 `SET NOT NULL` 실패 가능 → down 마이그레이션은 방어적으로 작성.

---

## 4. 백엔드 설계

### 4-1. 환경변수 (`.env`, 커밋 금지)

```
KAKAO_CLIENT_ID=<REST API 키>
KAKAO_CLIENT_SECRET=<보안 강화 시크릿(선택)>
KAKAO_CALLBACK_URL=http://localhost:3000/auth/kakao/callback
FRONTEND_URL=http://localhost:5173
```

- 부팅 시 카카오 키 없으면 카카오 라우트만 비활성(다른 로그인은 그대로). CRYPTO 키 검증과 같은 fail-soft 패턴.

### 4-2. Passport 전략

- `passport-kakao`의 `KakaoStrategy`. `validate(accessToken, refreshToken, profile)` → `profile.id`(회원번호), `profile._json.kakao_account.email`(있을 때), 닉네임.
- 전략은 **user를 만들지 않고** provider 프로필만 정규화해 넘긴다. 생성/조회는 서비스가 담당(§4-4).

### 4-3. 엔드포인트

```
GET /auth/kakao
  └ KakaoAuthGuard가 카카오 인가 페이지로 302. state(CSRF) 발급.

GET /auth/kakao/callback
  └ 카카오가 code와 함께 되돌림 → 전략이 프로필 취득
  └ AuthService.findOrCreateSocialUser(profile)
  └ 자체 JWT 발급
  └ 일회용 코드 발급 후 FRONTEND_URL/auth/callback?code=... 로 302 (§6)
```

### 4-4. `findOrCreateSocialUser(profile)`

```
1. (auth_provider='kakao', provider_user_id=profile.id)로 조회
   └ 있으면: 그 user 반환 (재방문)
2. 없으면: 미완성 소셜 유저 생성
   - role='caregiver', auth_provider='kakao', provider_user_id=profile.id
   - email = profile.email ?? null
   - password_hash = null (또는 UNUSABLE 센티널)
   - patient_id = null  ← 아직 환자 미연결 = "온보딩 필요" 상태
3. 이메일 충돌 처리: profile.email이 이미 로컬 계정에 있으면
   → 자동 병합하지 않는다(이번 범위 밖). email=null로 만들고 소셜 계정 별도 생성.
```

- **"온보딩 필요"의 단일 판정**: `patient_id IS NULL`. 소셜 최초 로그인 유저는 환자 레코드가 없다. `GET /auth/me` 응답에 `needsOnboarding: user.patientId === null && user.role==='caregiver'`를 실어 프론트가 라우팅한다.

### 4-5. 온보딩 `POST /auth/complete-onboarding`

- 입력: `patientDisplayName`, `patientModePin`(4자리) — 기존 RegisterDto의 그 필드 재사용.
- 처리: 현재 로그인 유저(`patient_id IS NULL`)에 대해 **환자 레코드 생성 + 연결**. 이는 기존 `register` 트랜잭션의 후반부와 동일 로직 → **공통 헬퍼로 추출해 재사용**.
- 이미 `patient_id`가 있으면 409(중복 온보딩 방지).

---

## 5. 프론트 설계

### 5-1. 콜백 라우트 `/auth/callback`

- `App.tsx`에 라우트 추가([App.tsx](../../frontend/src/App.tsx) 297~326 사이).
- 쿼리의 일회용 `code`를 `POST /auth/token`으로 교환(§6) → `ml_token` 저장 → `AuthContext` 갱신 → `needsOnboarding`이면 `/onboarding`, 아니면 `/caregiver`.

### 5-2. `LoginScreen` 버튼

- 기존 이메일/비번 폼 아래 "**카카오로 시작하기**"(카카오 노란색, 브랜드 가이드 준수) 버튼.
- 클릭 = `window.location.href = ${API}/auth/kakao` (SPA 라우팅 아님, 전체 이동).
- 구글 버튼은 D13에서 같은 자리에 추가.

### 5-3. 온보딩 화면 `/onboarding`

- 소셜 최초 로그인(`needsOnboarding`) 유저만 도달. 라우트 가드가 그 외 접근을 막는다.
- 필드: "어르신 성함", "환자 모드 PIN(4자리)". 제출 → `POST /auth/complete-onboarding` → `/auth/me` 재조회 → `/caregiver`.
- 기존 `LoginScreen`의 회원가입 폼에서 이 두 필드 검증 로직을 재사용.

---

## 6. 보안 고려사항

- **토큰 전달 = 일회용 코드 교환(권장)**: 콜백에서 JWT를 URL 쿼리로 직접 노출하지 않는다. 백엔드가 단명(60초) 일회용 `code`를 발급→프론트가 `POST /auth/token`으로 교환해 JWT 취득. URL 히스토리·로그에 장수명 토큰이 남지 않음.
  - 대안(간단): URL **fragment**(`#token=`)로 전달(서버 로그엔 안 남음). 보안·복잡도 절충안. 최초 구현은 일회용 코드 권장.
- **`state` 파라미터**로 CSRF 방어(인가 시작 시 발급, 콜백에서 검증).
- **Redirect URI 화이트리스트**: 카카오 콘솔에 등록한 정확한 콜백만 허용. `FRONTEND_URL`은 서버 설정값만 사용(오픈 리다이렉트 방지).
- **시크릿은 `.env`에만**. `CRYPTO_SECRET_KEY`처럼 프로덕션에서 누락 시 fail-fast.
- **PII(메모리 참조)**: 카카오 프로필의 실명·이메일은 기존 PII 마스킹·암호화 정책 대상인지 확인 후 저장. 표시 이름 외 민감정보는 최소 수집.

---

## 7. 테스트 계획

**백엔드**
- `findOrCreateSocialUser`: (a) 재방문 → 동일 user, (b) 신규 → patient_id NULL 미완성 유저, (c) 이메일 없는 카카오 → email NULL 저장, (d) 이메일이 기존 로컬과 충돌 → 병합 안 함.
- 콜백: 유효 프로필 → JWT 발급 + 일회용 코드 리다이렉트.
- `complete-onboarding`: patient 레코드 생성·연결, 중복 온보딩 409.
- 회귀: 기존 로컬 register/login이 `auth_provider='local'`로 그대로 동작.

**프론트**
- 콜백 라우트: code 교환 성공 → 토큰 저장 + 라우팅 분기(온보딩 유무).
- 온보딩 폼: 성함 필수·PIN 4자리 검증.
- 로그인 화면: 카카오 버튼이 `${API}/auth/kakao`로 이동.

---

## 8. 구글 확장 (D13, 후속)

- `passport-google-oauth20` + `GET /auth/google`·`/auth/google/callback`.
- `findOrCreateSocialUser`는 provider만 'google'로 바꿔 **그대로 재사용**(구글은 이메일 항상 제공 → email 채워짐).
- 프론트는 로그인·온보딩 UI에 구글 버튼만 추가. 콜백 라우트·온보딩 로직 공유.

---

## 9. 사용자 준비물 (구현 전 필수)

구현은 계획대로 진행하되, **실제 동작 테스트에는 아래가 필요**하다. 이것들은 사용자만 발급 가능하며, 받는 즉시 `.env`에 넣는다(커밋 금지).

1. **카카오**: [Kakao Developers](https://developers.kakao.com) → 애플리케이션 추가 → **REST API 키** 확보 → 카카오 로그인 활성화 → **Redirect URI** 등록(`http://localhost:3000/auth/kakao/callback`, 배포 도메인도) → 동의항목에서 닉네임(필수)·이메일(선택) 설정.
2. **구글(후속)**: Google Cloud Console → OAuth 동의화면 + OAuth 클라이언트 ID/시크릿 → 승인된 리디렉션 URI 등록.
3. 배포 시 프로덕션 콜백·`FRONTEND_URL`을 별도 등록.

---

## 10. 미해결/추후 결정

- **계정 병합**: 한 사람이 이메일 계정과 카카오를 둘 다 쓰면 지금은 별개 계정. 병합 UX는 후속 결정.
- **토큰 전달 최종안**: 일회용 코드(권장) vs fragment — 구현 착수 시 확정.
- **로컬 이메일↔소셜 충돌 정책**: 현재 "병합 안 함". 사용자 혼란이 크면 "기존 계정으로 로그인 유도" UX 추가.

---

## 11. 구현 순서 (계획 승인 후)

1. D1 스키마 + 마이그레이션 → 로컬 회귀 그린 확인
2. D2 설정 + D3 전략 + D4 콜백(일회용 코드) + D5 findOrCreate + D7 보안
3. D6 온보딩 엔드포인트 (register 트랜잭션 공통 헬퍼 추출)
4. D8~D10 프론트(콜백 라우트 → 로그인 버튼 → 온보딩 화면)
5. D11·D12 테스트
6. **사용자가 카카오 키 제공** → 실기기 e2e 검증
7. D13 구글 확장
