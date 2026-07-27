# 계정 병합 (하이브리드: 자동 연결 + 수동 연결) — Feature Plan

> 작성일: 2026-07-27
> 작성자: Feature Architect (Claude)
> 적용 범위: 한 사람이 카카오·구글을 오가며 로그인할 때 계정이 갈라지지 않도록 병합
> 확정 결정: (D-A) 방식 = **하이브리드**(자동 연결 + 수동 연결) / (D-B) 진행 = **2단계 분할** / (D-C) 사후 데이터 통합은 **범위 제외**

---

## 0. 배경 및 문제

[소셜 로그인](20260726_SocialLogin_feature_plan.md) 도입 후, `User`는 `auth_provider` +
`provider_user_id`를 **각 1개**만 갖는다("유저당 로그인 수단 1개"). 그래서 같은 사람이
**다른 provider로 로그인하면 서로 다른 계정**이 된다.

- 어제 카카오로 가입 → 환자 등록, 데이터 축적
- 오늘 실수로 구글 버튼 → 백엔드는 "처음 보는 사용자" → **빈 계정**으로 온보딩부터 다시
- 기존 [findOrCreateSocialUser](../../backend/src/auth/auth.service.ts)는 이메일 충돌 시
  **일부러 병합을 피하고** `email=null`로 새 계정을 만들어, 데이터가 두 계정에 갈라진다.

실제 DB 확인: 현재 보호자 계정이 카카오(email=null)·구글(wsji9404@gmail.com) **2개로 갈라져
있다** — 바로 이 문제의 사례.

## 1. 방식과 커버 범위

| 방식 | 커버하는 상황 | 못 막는 상황 |
|---|---|---|
| **자동 연결** | 두 provider가 **같은 검증된 이메일**을 줄 때 → 실수 로그인해도 자동 합류 | 이메일 다름/없음 |
| **수동 연결** | 로그인 상태에서 "구글 연결하기"를 직접 눌러 연결(이메일 무관) | 실수로 빈 계정에 떨어진 그 순간(아직 연결 전) |

두 방식이 **서로 다른 구멍**을 막으므로 하이브리드로 둘 다 채택.
자동 연결은 **검증된 이메일에만** 허용한다 — 미검증 이메일로 붙이면 계정 탈취 위험.

**범위 제외**: 이미 데이터가 양쪽에 갈라진 뒤의 **사후 데이터 통합**(어느 환자·이력을 살릴지
정책이 복잡, 실사용 빈도 낮음).

## 2. 핵심 구조: `user_social_identities`

계정 병합은 "유저 1명 ↔ 로그인 수단 여러 개"라, 재방문 로그인 조회의 근거를 별도 테이블로 옮긴다.

```
user_social_identities
  id, user_id → users.id(CASCADE), provider, provider_user_id, email(참고), created_at
  UNIQUE(provider, provider_user_id)   -- 한 소셜계정은 한 유저에만
  UNIQUE(user_id, provider)            -- 유저당 provider 1개(카카오1+구글1)
```

- `users.auth_provider/provider_user_id`는 **"최초/주 provider" 표시용으로 유지**(로그인 조회
  근거는 identity 테이블로 이동). 기존 소셜 유저는 마이그레이션에서 **백필**.

## 3. 단계 분할

| 단계 | 내용 | 상태 |
|---|---|---|
| **1단계** | identity 테이블 + 마이그레이션 + `emailVerified` 캡처 + 자동 연결(백엔드만) | ✅ 구현 완료 |
| **2단계** | 수동 연결 + 해제 + `linkedProviders` + 계정 연결 UI | ✅ 구현 완료 |

### 2단계 수동 연결 흐름

브라우저 top-level 이동엔 Authorization 헤더가 없어, 유저 의도를 쿠키로 나른다.

1. `POST /auth/link/start`(JWT) → 1회용 link code 발급(단명·in-memory)
2. `GET /auth/:provider/link?code=`(`LinkInitiateGuard`) → code를 httpOnly 쿠키로 옮기고
   CSRF state 심은 뒤 소셜 인가로 리다이렉트
3. `GET /auth/:provider/callback` → link 쿠키가 있으면 **연결 모드**: code를 1회 소비해
   userId를 얻고, `linkSocialIdentity`로 현재 계정에 신원을 붙인 뒤
   `/caregiver?linked=..`(실패 시 `?linkError=..`)로 복귀. 없으면 로그인 모드.
4. `DELETE /auth/link/:provider`(JWT) → 해제. **마지막 로그인 수단(비번 없는 소셜 1개)은
   403.** users의 "주 provider"가 방금 뺀 것이면 남은 신원/로컬로 재지정.

- 연결 충돌: 그 소셜계정이 다른 유저에 있으면 409, 같은 유저면 멱등, 유저당 provider 1개.
- `UserResponse.linkedProviders`는 `getMe`·소셜 로그인 응답에서 채운다.
- 프론트: [AccountLinkScreen](../../frontend/src/memory-link/caregiver/presentation/AccountLinkScreen.tsx)
  ("연결된 계정" 화면, 대시보드 "계정" 버튼), `?linked/?linkError` 배너 처리.

### 1단계 자동 연결 로직 (`findOrCreateSocialUser`)

1. `(provider, providerUserId)` identity가 있으면 → 그 유저로 재방문 로그인
2. 없으면(트랜잭션): **검증 이메일**이 기존 (환자 아님) 계정과 일치 → 그 계정에 identity 붙여 합류
3. 그마저 없으면 → `patient_id=null` 미완성 보호자 신규 생성 + identity 연결

경합(유니크 위반)은 트랜잭션을 롤백시키고 트랜잭션 **밖**에서 재조회/재시도한다
(Postgres는 트랜잭션 내 첫 에러 이후 그 트랜잭션의 모든 쿼리를 거부하므로).

## 4. 관련 파일 (1단계)

- [social-identity.entity.ts](../../backend/src/auth/entities/social-identity.entity.ts)
- [M14 마이그레이션](../../backend/src/database/migrations/1784500000000-create-social-identities.ts)
- [auth.service.ts](../../backend/src/auth/auth.service.ts) `findOrCreateSocialUser`/`attachOrCreateForSocial`
- [social-profile.ts](../../backend/src/auth/social-profile.ts) `emailVerified`
- [kakao.strategy.ts](../../backend/src/auth/kakao.strategy.ts) / [google.strategy.ts](../../backend/src/auth/google.strategy.ts)
