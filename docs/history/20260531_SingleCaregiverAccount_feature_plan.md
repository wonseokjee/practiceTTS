# 보호자 단일 계정 모델 — Feature Plan

> 작성일: 2026-05-31
> 작성자: Feature Architect (Claude)
> 적용 범위: 인증 모델 재설계 — 환자 직접 로그인 폐지, 보호자 1계정 + 앱 내 환자 모드 전환
> 확정 결정: (D1) 환자 사용 방식 = 앱 내 모드 전환 / (D2) 환자 레코드 = 로그인 없는 users 행 유지 / (D3) 환자 레코드 생성 = 보호자 회원가입 시 동시 생성

---

## 0. 배경 및 문제

현재 구조는 **환자와 보호자가 각각 독립 계정**으로 로그인한다([user.entity.ts](../../backend/src/auth/entities/user.entity.ts), [App.tsx](../../frontend/src/App.tsx)).

- 보호자: `role='caregiver'`, `patientId` → 환자 user 참조
- 환자: `role='patient'`, 직접 email/password로 로그인 → `/patient`

그러나 **치매/실어증 환자가 직접 이메일·비밀번호로 로그인하는 것은 현실적이지 않다.** 보호자가 기기를 세팅하고 환자에게 건네는 실사용 시나리오에 맞춰, **보호자 단일 계정**으로 전환한다.

### 핵심 개념 변경

```
[기존]
  환자 계정   ──로그인──▶ /patient   (role=patient, 본인 id = 환자 id)
  보호자 계정 ──로그인──▶ /caregiver (role=caregiver, patientId → 환자)

[변경]
  보호자 계정 ──로그인──▶ /caregiver  (유일한 로그인 주체)
       │
       └─ patientId ──▶ 환자 레코드 (users 행, password 없음 = 로그인 불가)
  보호자가 앱 내에서 "환자 모드" 전환 ──▶ /patient (연결된 환자 데이터로 동작)
```

### 설계 원칙

1. **스키마 무변경**: 환자는 여전히 `users` 행이므로 Phase 1 데일리 퀴즈 스키마를 포함한 모든 `patient_id` FK가 그대로 유효하다. **마이그레이션 불필요.**
2. **하위호환**: 기존 `role='patient'` 직접 로그인 경로를 제거하지 않는다. 점진적 전환 + 기존 테스트 데이터 보존.
3. **단일 진실 원천**: "지금 어느 환자를 다루는가"는 **백엔드에서 토큰 기준으로 도출**한다 (effective patientId). 프론트가 임의 patientId를 보내 타 환자 데이터에 접근하는 것을 차단.
4. **보안**: 보호자는 **자신과 연결된 환자**의 데이터에만 접근 가능. effective patientId는 `req.user`에서만 파생하며 클라이언트 입력을 신뢰하지 않는다.

---

## 1. 개요 및 범위

### 1-1. Deliverable

| # | Deliverable | 계층 | 비고 |
|---|---|---|---|
| D1 | `RegisterDto`에 `patientDisplayName` 추가, `patientId`/`role` 입력 폐기(서버 강제 caregiver) | 백엔드 DTO | §4-1 |
| D2 | `AuthService.register()` 트랜잭션 확장: 보호자 + 환자 레코드 동시 생성·연결 | 백엔드 서비스 | §4-1 |
| D3 | 로그인 없는 환자 레코드 생성 규약 (placeholder email, password 없음) | 백엔드 도메인 | §4-1 |
| D4 | `@EffectivePatientId()` 파라미터 데코레이터(또는 헬퍼) 신설 | 백엔드 공통 | §4-2 |
| D5 | `training.controller` 6개 핸들러를 effective patientId 사용으로 전환 | 백엔드 컨트롤러 | §4-2 |
| D6 | 보호자→환자 소유권 가드 (`user.patientId` 일치 검증) | 백엔드 가드 | §4-3 |
| D7 | `AuthContext`에 `viewMode` + `enterPatientMode/exitPatientMode` 추가 | 프론트 상태 | §5-1 |
| D8 | `App.tsx` 라우트 가드 갱신: caregiver가 환자 모드일 때 `/patient` 허용 | 프론트 라우팅 | §5-2 |
| D9 | 모드 전환 UI: CaregiverDashboard "환자 모드" 진입, 환자 화면 "보호자로 돌아가기" | 프론트 UI | §5-3 |
| D10 | `LoginScreen` 회원가입 재설계: 보호자 전용 + "어르신 성함" 필드, 역할 토글 제거 | 프론트 UI | §5-4 |
| D11 | dev 토글 연동: `VITE_DEV_AUTH=caregiver` 시 환자 모드 진입 가능 | 프론트 dev | §5-5 |
| D12 | 백엔드 단위 테스트: register 동시 생성, effective patientId 분기, 소유권 | 테스트 | §8 |
| D13 | 프론트 테스트: viewMode 전환, 라우팅 가드, 회원가입 폼 검증 | 테스트 | §8 |

### 1-2. 비범위 (명시적 제외)

- ❌ 환자 레코드를 `users`에서 제거하고 별도 `profile` 테이블로 분리 (대규모 FK 재구성 — 보류 결정 D2)
- ❌ 한 보호자가 여러 환자를 관리 (multi-patient) — 본 plan은 1:1 유지, 향후 확장. **확장 시**: placeholder email(`local.invalid`)·displayName만으로는 환자 식별 불충분 → 실 patient 식별자/선택 UI 필요(F5).
- ❌ 환자 모드 PIN 재설정/분실 복구 UI — 본 plan은 가입 시 설정만. 추후 보호자 비번 재인증으로 PIN 변경 추가.
- ❌ therapist 역할 동작 변경 — 현행 유지
- ❌ 기존 `role='patient'` 직접 로그인 경로 제거 — 하위호환 유지
- ❌ 데일리 퀴즈 Quiz 컨트롤러 적용 — Quiz 컨트롤러는 Phase 3에서 신설되므로, 그때 §4-2 데코레이터를 처음부터 사용 (본 plan에서 미리 규약만 확정)
- ❌ 보호자 비밀번호 재설정/이메일 인증 등 계정 관리 — 별도

### 1-3. 사전 조건

- 데일리 퀴즈 Phase 1 스키마 적용됨 (환자=users 행 전제 유지).
- `accessToken`(camelCase) 응답 형식 + dev 로그인 토글(`VITE_DEV_AUTH`)은 선행 작업에서 정리됨.

---

## 2. 클린 아키텍처 레이어 매핑

```
backend/src/
├── auth/
│   ├── dto/register.dto.ts                     [MODIFY] patientDisplayName 추가, role/patientId 폐기
│   ├── auth.service.ts                          [MODIFY] register() 트랜잭션 — 보호자+환자 동시 생성
│   ├── auth.controller.ts                       [수정 없음] register는 dto만 위임
│   ├── decorators/effective-patient-id.decorator.ts  [NEW] §4-2
│   └── guards/patient-ownership.guard.ts        [NEW] (선택) §4-3
│
├── training/
│   └── training.controller.ts                   [MODIFY] req.user.id → @EffectivePatientId()
│
└── common/ (또는 auth 내부)
    └── effective-patient-id.util.ts             [NEW] role 분기 순수 함수 (테스트 용이)

frontend/src/
├── memory-link/shared/
│   ├── AuthContext.tsx                          [MODIFY] viewMode 상태 + 전환 액션
│   └── LoginScreen.tsx                          [MODIFY] 회원가입 보호자 전용 재설계
├── memory-link/caregiver/presentation/
│   └── CaregiverDashboard.tsx                   [MODIFY] "환자 모드" 진입 버튼
├── memory-link/patient/presentation/
│   └── PatientDashboard.tsx                     [MODIFY] "보호자로 돌아가기" 버튼
└── App.tsx                                       [MODIFY] PatientRoute/RootRedirect 가드 갱신
```

**의존 규칙**
- effective patientId 순수 함수는 NestJS 런타임에 의존하지 않는다(입력: `{role, id, patientId}` → 출력: `string`). 데코레이터가 `req.user`에서 값을 뽑아 순수 함수에 위임.
- `AuthContext`의 `viewMode`는 클라이언트 상태일 뿐, **권한의 원천이 아니다.** 실제 환자 식별은 항상 백엔드 토큰 기준.

---

## 3. 도메인 규칙

### 3-1. 환자 레코드 (로그인 없는 user)

| 항목 | 규칙 |
|---|---|
| `role` | `'patient'` |
| `email` | placeholder, 충돌 회피 + 로그인 불가 표식. 예: `patient+<uuid>@local.invalid` (UNIQUE 만족, 실 도메인 아님) |
| `passwordHash` | 로그인 불가 sentinel. 빈 문자열 대신 **bcrypt가 절대 일치하지 않는 고정 불용 값**(예: `'!'`) 저장 → `bcrypt.compare`가 항상 false |
| `displayName` | 보호자가 입력한 "어르신 성함" |
| `patientId` | `null` (환자 자신은 환자를 가리키지 않음) |

> placeholder email은 사용자에게 노출되지 않으며(로그인/표시에 쓰지 않음), UNIQUE 제약만 만족하면 된다.

### 3-2. effective patientId 도출 (순수 함수)

```
resolveEffectivePatientId(user):
  - role === 'patient'   → user.id            (하위호환: 환자 직접 로그인)
  - role === 'caregiver' → user.patientId      (없으면 409/400: 연결된 환자 없음)
  - 그 외(therapist 등)  → 예외 (환자 데이터 접근 불가)
```

### 3-3. 유스케이스

| UC | Actor | 정상 흐름 | 예외 |
|---|---|---|---|
| UC-1 보호자 회원가입 | 비로그인 | email/pw/보호자명/어르신명 입력 → 보호자+환자 동시 생성 → 토큰 발급 | 이메일 중복 409 / 검증 실패 400 |
| UC-2 환자 모드 전환 | 보호자 | 대시보드에서 "환자 모드" → `/patient`, viewMode=patient | patientId 없으면 안내 |
| UC-3 환자 데이터 조회 | 보호자(환자모드) | training/quiz API 호출 → 백엔드가 effective patientId=보호자.patientId로 조회 | 연결 환자 없음 시 차단 |
| UC-4 보호자 복귀 | 보호자 | 환자 화면 "보호자로 돌아가기" → `/caregiver`, viewMode=caregiver | — |

---

## 4. 백엔드 설계

### 4-1. 보호자 회원가입 = 보호자 + 환자 동시 생성

**`RegisterDto` (MODIFY)** — `backend/src/auth/dto/register.dto.ts`

```typescript
export class RegisterDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsString() @MinLength(1) displayName: string;         // 보호자 본인 이름
  @IsString() @MinLength(1) patientDisplayName: string;  // [NEW] 어르신 성함
  // role 폐기 — 서버가 'caregiver' 강제
  // patientId 폐기 — 서버가 환자 레코드를 새로 생성
}
```

> 하위호환: 기존 `role`/`patientId` 필드를 보내는 구(舊) 클라이언트가 있다면 `@IsOptional()`로 무시하거나 deprecate. 본 plan은 신규 흐름 기준으로 재설계하되, 서버는 항상 caregiver로 처리.

**`AuthService.register()` (MODIFY)** — 단일 트랜잭션 (Eng Review Issue 1 = 1A 반영)

```
register(dto):
  - 트랜잭션 (DataSource.transaction):
      1) 환자 user 생성: role='patient', email=placeholder, passwordHash=UNUSABLE_PASSWORD_HASH,
         displayName=dto.patientDisplayName, patientId=null
      2) 보호자 user 생성: role='caregiver', email=dto.email, passwordHash=bcrypt(pw),
         displayName=dto.displayName, patientId=(1).id
  - email UNIQUE 제약 위반(QueryFailedError, code 23505) → catch → ConflictException(409)
  - 보호자에 대해 토큰 발급
  - 반환: { accessToken, user: 보호자(UserResponse) }
```

> **원자성(Issue 1)**: 사전 중복 검사 대신 두 행을 **단일 트랜잭션 내에서 생성**하고, DB email UNIQUE 제약을 진짜 가드로 삼는다. 동시 가입 경합 시에도 한쪽 트랜잭션이 통째로 롤백되어 **orphan 환자 레코드가 남지 않는다**. 위반 에러를 409로 변환.
> 환자 먼저 생성 후 id를 보호자 patientId에 연결.
> 매직값은 named 상수로: `PATIENT_PLACEHOLDER_EMAIL_DOMAIN`(`local.invalid`), `UNUSABLE_PASSWORD_HASH`.

### 4-2. effective patientId 도출

**순수 함수** — `backend/src/auth/effective-patient-id.util.ts` (NEW)

```typescript
export function resolveEffectivePatientId(user: {
  id: string; role: UserRole; patientId: string | null;
}): string {
  if (user.role === 'patient') return user.id;
  if (user.role === 'caregiver') {
    if (!user.patientId) {
      throw new BadRequestException('연결된 환자가 없습니다.');
    }
    return user.patientId;
  }
  throw new ForbiddenException('환자 데이터에 접근할 수 없는 역할입니다.');
}
```

**파라미터 데코레이터** — `backend/src/auth/decorators/effective-patient-id.decorator.ts` (NEW)

```typescript
export const EffectivePatientId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    return resolveEffectivePatientId(req.user);
  },
);
```

**`training.controller.ts` (MODIFY)** — 6개 핸들러

```typescript
// before
return this.trainingService.findAvailableEntries(req.user.id);
// after
@Get('entries')
findAvailableEntries(@EffectivePatientId() patientId: string) {
  return this.trainingService.findAvailableEntries(patientId);
}
```

> `training.service`는 **변경 없음** — 이미 `patientId: string` 인자를 받는다. 컨트롤러에서 주입 소스만 교체.
> Quiz 컨트롤러(Phase 3)는 처음부터 `@EffectivePatientId()`를 사용한다.

### 4-3. 소유권/권한

- effective patientId가 곧 소유권 경계다. 보호자는 자신의 `patientId`만 얻으므로, 타 환자 데이터 접근이 구조적으로 불가능.
- 별도 `PatientOwnershipGuard`는 **선택**(데코레이터만으로 충분). 향후 `:patientId` 경로 파라미터를 받는 엔드포인트가 생기면 그때 가드로 일치 검증 추가.

### 4-4. 환자 로그인 차단 (Eng Review Issue 2 = 2A 반영)

- **명시적 조기 거부**: `AuthService.login`에서 사용자 조회 후, **bcrypt 비교 전에** "사용 가능한 비밀번호가 없는 계정"(예: `role==='patient'` 또는 `passwordHash === UNUSABLE_PASSWORD_HASH`)이면 **즉시 `UnauthorizedException(401)`** 반환.
- 이렇게 하면 bcrypt가 비정상 해시 입력에 대해 throw할 가능성(→ 500)에 의존하지 않는다. explicit > clever.
- 환자 placeholder `passwordHash`는 `UNUSABLE_PASSWORD_HASH` 상수(명백히 로그인 불가 표식). §10 Q2 해결.

### 4-5. 환자 모드 복귀 PIN (Outside Voice F2 대응)

- **컬럼 추가**: `users.patient_mode_pin_hash VARCHAR NULL` (보호자에만 설정). **1개 추가 마이그레이션**(additive nullable, online 안전 — Phase 1 caregiver_wish_message와 동일 패턴). "스키마 무변경" 원칙은 "additive nullable 1개"로 완화.
- **설정 시점**: 보호자 회원가입 시 `RegisterDto.patientModePin`(4자리 숫자) 입력 → `bcrypt` 해시하여 보호자 user에 저장.
- **검증 엔드포인트**: `POST /auth/patient-mode/verify-pin` (JwtAuthGuard, body `{pin}`) → `bcrypt.compare(pin, req.user.patientModePinHash)` → 200 `{ok:true}` / 401. **백엔드 검증**이라 devtools 우회 불가.
- **불변식**: PIN 해시는 응답 DTO(`toUserResponse`)에서 항상 제외(passwordHash와 동일 취급, `select:false` 또는 명시 omit).

> 위협 모델: "환자가 화면의 버튼을 눌러 보호자 사적 데이터 접근". 백엔드 검증 PIN이면 충분히 차단. 본격 인증이 아니라 **로컬 보호 잠금**.

**연속 실패 정책 (Design Review Issue 1 = 점증 디레이, 잠금 없음)**: `verify-pin`는 실패 횟수에 따라 **점증 대기**를 강제한다(예: 1~2회 즉시, 3회 후 5초, 4회 후 15초, 5회+ 30초). **백엔드에서 rate-limit**(세션/계정 단위)으로 강제해 devtools 우회 불가. 하드 잠금/계정 비번 폴백은 없음(진짜 보호자가 답답하지 않게). 프론트는 대기 중 입력 비활성 + 남은 시간 표시.

---

## 5. 프론트엔드 설계

### 5-1. `AuthContext` — 환자 모드 상태 + PIN (Eng Review 갱신: S1 부분 철회)

> **결정 이력**: 초기 S1은 viewMode를 제거했으나, Outside Voice F2가 "환자에게 기기를 건넨 동안 '보호자로 돌아가기'가 항상 노출 → 환자가 눌러 보호자 사적 데이터(무드·reflection) 접근 → Phase 1 격리 붕괴"를 지적. **PIN 잠금 + 모드 상태 복원**으로 결정. viewMode를 다시 도입하되 복귀에 PIN을 요구한다.

```typescript
interface AuthContextValue {
  user / token / isLoading / login / register / logout ...
  isPatientMode: boolean;                       // [NEW] localStorage 영속 (새로고침 유지)
  enterPatientMode: () => void;                 // [NEW] flag set + navigate('/patient')
  exitPatientMode: (pin: string) => Promise<boolean>; // [NEW] PIN 검증 성공 시만 해제
}
```

규칙:
- `isPatientMode`는 **localStorage에 영속**한다. 환자가 기기에서 새로고침해도 잠금이 풀리지 않아야 하므로(F1·F2 동시 해결).
- `exitPatientMode(pin)`는 `POST /auth/patient-mode/verify-pin` 호출(§4-5) 성공 시에만 flag 해제.
- dev `VITE_DEV_AUTH=caregiver`: enter/exit 동작 확인 가능.

### 5-2. 라우팅 가드 (`App.tsx`) — 모드 인지 (F1 해결)

- **`PatientRoute`**: 허용 조건
  - `role==='patient'` (하위호환), 또는
  - `role==='caregiver' && isPatientMode && user.patientId != null`
  - `role==='caregiver' && !isPatientMode` → `/caregiver`
  - patientId==null → 안내 후 `/caregiver`
- **`RootRedirect`**: caregiver면 **isPatientMode ? `/patient` : `/caregiver`** (잠금 상태에서 "/" 접근해도 환자 화면 유지 — F1 해결), patient → `/patient`.
- **`CaregiverRoute`**: `role==='caregiver' && !isPatientMode`만 허용 (환자 모드 중엔 /caregiver 직접 접근도 차단 → PIN 필요).
- **`LoginRoute`**: 현행 유지.

### 5-3. 모드 전환 UI

- **CaregiverDashboard**: "환자에게 건네기 (환자 모드)" 버튼 → `enterPatientMode()` (flag set + `/patient`)
- **PatientDashboard**: "보호자로 돌아가기" 버튼 — `role==='caregiver' && isPatientMode`일 때만 노출 → **PIN 입력 모달** → `exitPatientMode(pin)` 성공 시 `/caregiver`. 실패 시 모달 유지 + 에러.
  - 기존 "로그아웃" 버튼은 `role==='patient'`(하위호환 직접 로그인) 시에만 노출

### 5-4. `LoginScreen` 회원가입 재설계

- 회원가입 탭: **역할 라디오(caregiver/patient) 제거**.
- 필드: 보호자 email, password, 보호자 displayName, **어르신 성함(patientDisplayName)**.
- `register({ email, password, displayName, patientDisplayName })` 호출.
- 로그인 탭: 변경 없음(email/password).

### 5-6. 인터랙션 상태 + 카피·톤 (Design Review Pass 2/3) — Warm Clinical 토큰

| Surface | LOADING | 초기 | ERROR | SUCCESS |
|---|---|---|---|---|
| **PIN 모달** | 확인 버튼 비활성 + 스피너, 입력 잠금(180ms) | surface #FFFFFF, radius xl(24px). 4칸 PIN(숫자) + "기기를 돌려주셨네요. 보호자 PIN을 입력해주세요" + 취소 | 입력 테두리 error 색 + "PIN이 일치하지 않아요. 다시 입력해주세요" + 입력 초기화 (**bounce/shake 금지**, 색·테두리로만). 디레이 중: "잠시 후 다시 시도해주세요 (N초)" | 모달 닫힘 → /caregiver (별도 화면 없음, 180ms fade) |
| **회원가입 폼** | 제출 버튼 비활성 + 스피너 | 필드 placeholder, PIN 안내 "환자에게 기기를 건넸다가 돌아올 때 쓰는 4자리 숫자" | 필드별 인라인 에러 + 이메일 중복 시 상단 배너 "이미 사용 중인 이메일이에요" | 자동 로그인 → /caregiver |

**카피·톤 원칙**: 돌봄 맥락 — 비난조 금지("틀렸습니다" ❌ → "일치하지 않아요" ✓), 보호자를 안심시키는 따뜻한 1인칭. "환자에게 건네기" 버튼 라벨은 "환자 모드로 전환" 같은 기계어 대신 행동 중심.

**AI 슬롭 가드 (Pass 4, APP UI)**: PIN 모달은 generic iOS 4-dot/중앙정렬 버블 모달로 흐르지 말 것. Warm Clinical 어휘 준수(세이지 그린 #2D6A56 포커스 링, 크림 #F7F6F3 배경, PIN 입력칸 radius md(12px)). **장식용 그림자/블롭/이모지 금지**, 불필요한 카드 래핑 금지. 모달은 surface #FFFFFF + radius xl(24px) 단일 패널.

### 5-7. 접근성 (Design Review Pass 6) — 고령 보호자 대상

- **PIN 입력**: `inputMode="numeric"` + `pattern="[0-9]*"` → 모바일 숫자 키패드. 자동 포커스 + 칸 간 자동 이동.
- **터치 타깃**: 모든 버튼·PIN 칸 **최소 44×44px**(DESIGN.md WCAG AA). 회원가입 입력은 고령자 고려 `min-h-[48px]`.
- **모달 포커스 트랩**: PIN 모달 열릴 때 첫 칸 포커스, Tab 순환 모달 내 한정, Esc=취소, 배경 클릭 시 닫힘 여부 명시(권장: 취소).
- **스크린리더**: 모달 `role="dialog"` + `aria-modal` + `aria-labelledby`. 에러는 `role="alert"` `aria-live="assertive"`.
- **대비**: error/warning 텍스트 대비 4.5:1 이상.

### 5-5. dev 토글 연동

- `VITE_DEV_AUTH=caregiver`: 가짜 보호자 + `VITE_DEV_PATIENT_ID`. /caregiver에서 /patient로 이동하면 환자 모드 왕복 테스트 가능(별도 상태 불요).
- `off`: 실제 신규 회원가입/로그인 플로우 검증.

---

## 6. DTO/응답 변경 요약

| 대상 | 변경 |
|---|---|
| `RegisterDto` | `+patientDisplayName`, `-role`, `-patientId` (서버 강제) |
| register 응답 | 변경 없음(`{accessToken, user}`) — user는 보호자 |
| `AuthUser`(프론트) | 변경 없음(이미 role/patientId 보유) |
| training 응답 DTO | 변경 없음 |

---

## 7. 데이터 모델 / 마이그레이션

- **additive nullable 컬럼 1개**: `users.patient_mode_pin_hash VARCHAR NULL` (§4-5). `ADD COLUMN ... NULL` → online 무중단.
- 그 외 스키마 무변경. 환자는 계속 `users` 행 → Phase 1 FK 전부 유효.
- 데이터: 보호자 가입 시 환자 행 1개 추가 생성(트랜잭션, manager 사용).
- **트랜잭션 구현(F6)**: `dataSource.transaction(async (manager) => {...})` 내에서 **두 save 모두 `manager.getRepository(User)` 사용** — 기본 repo로 저장하면 트랜잭션 밖으로 새는 흔한 실수.
- **하위호환(F4 정정)**: 기존 `role='patient'` 계정의 **인증만 보존**(이미 존재하는 비밀번호로 로그인 가능). 신규 patient/therapist **생성 경로는 제공하지 않음**(RegisterDto는 caregiver 전용). test9의 legacy patient 픽스처는 **테스트에서 repo 직접 INSERT**(실 password hash 부여)로 생성.
- **불변식(F3)**: effective patientId 안전성은 "JWT payload에 role/patientId를 넣지 않고, 매 요청 `validateUser`가 DB에서 최신 User 조회"에 의존한다. **이 불변식을 깨고 토큰 클레임으로 최적화하면 클라이언트 신뢰 차단이 무너진다** — 변경 금지.

---

## 8. 테스트 전략 (Given-When-Then)

### 백엔드 (Jest)
1. **register 동시 생성**: Given 유효 dto, When register, Then users에 보호자+환자 2행 생성 & 보호자.patientId=환자.id & 환자.passwordHash=UNUSABLE_PASSWORD_HASH.
2. **이메일 중복 + 롤백**: Given 기존 보호자 email, When register, Then 409 **AND orphan 환자 행 0개**(트랜잭션 롤백 단언). (Issue 1)
3. **effective patientId(caregiver)**: Given role=caregiver+patientId=X, When resolve, Then X.
4. **effective patientId(patient)**: Given role=patient id=Y, When resolve, Then Y.
5. **effective patientId(연결 없음)**: Given caregiver patientId=null, When resolve, Then 400.
6. **effective patientId(therapist)**: Then 403.
7. **환자 로그인 차단(조기 거부)**: Given role=patient/UNUSABLE_PASSWORD_HASH 계정, When login(any pw), Then **401(500 아님)** & bcrypt.compare 미호출. (Issue 2)
8. **training entries(보호자)**: Given 보호자 토큰, When GET /training/entries, Then 연결된 환자 데이터 반환.
9. **[CRITICAL 회귀] training entries(legacy patient)**: Given repo 직접 INSERT한 role=patient(실 password) 토큰, When GET /training/entries, Then **본인(user.id) 데이터 반환** — effective patientId 전환이 기존 환자 경로를 깨지 않음을 증명. (IRON RULE)
10. **PIN 검증**: Given 보호자(PIN=1234), When verify-pin('1234'), Then 200; When verify-pin('0000'), Then 401.
11. **PIN 응답 누출 차단**: register/me/login 응답에 patientModePinHash 미포함.

### 프론트 (Vitest)
1. **PatientRoute(caregiver+patientMode)**: caregiver & isPatientMode & patientId → 허용.
2. **PatientRoute(caregiver+!patientMode)**: caregiver & !isPatientMode → /caregiver 차단.
3. **PatientRoute(legacy patient)**: role=patient → 허용(하위호환).
4. **회원가입 폼**: patientDisplayName/patientModePin 누락 시 제출 차단 + 역할 토글 부재 확인.
5. **"보호자로 돌아가기" + PIN 모달**: role=caregiver & isPatientMode → 버튼 노출; 클릭 시 PIN 모달; 올바른 PIN → exitPatientMode 호출 & /caregiver; 틀린 PIN → 모달 유지.
6. **RootRedirect 모드 인지**: caregiver & isPatientMode → /patient (잠금 유지).
7. **enterPatientMode 영속**: 호출 후 localStorage flag set, 새로고침해도 isPatientMode 유지.

---

## 9. 하위호환 / 롤아웃

- 기존 `role='patient'` 로그인 경로·테스트 보존(제거 시점은 별도).
- training.service 시그니처 불변 → 회귀 위험 최소.
- 단계적: 백엔드(effective patientId + register) → 프론트(viewMode/라우팅/회원가입) → E2E.

---

## 10. 미결정 / 리스크

| ID | 항목 | 결정 |
|---|---|---|
| Q1 | 환자 placeholder email 형식 | ✅ 해결: `patient+<uuid>@local.invalid` (스키마 무변경) |
| Q2 | login에서 환자 거부 | ✅ 해결(Issue 2 = 2A): bcrypt 전 **명시적 조기 401** |
| Q3 | viewMode 새로고침 유지 | ✅ 해결(S1): viewMode 자체를 제거 |
| Q4 | 구 RegisterDto(role/patientId) 처리 | ✅ 해결: 필드 **제거**(호출처 전부 자가 소유, 출시 전) |
| Q5 | therapist의 환자 접근 | 본 plan 제외(403), 추후 |

---

## 11. 작업 체크리스트

### Phase A: 백엔드 — `[보통]`
- [ ] 마이그레이션: `users.patient_mode_pin_hash` 추가(additive nullable)
- [ ] `effective-patient-id.util.ts` 순수 함수 + named 상수 + 단위 테스트(3~6)
- [ ] `@EffectivePatientId()` 데코레이터
- [ ] `training.controller` 6개 핸들러 전환 + 회귀 테스트(test9 CRITICAL: legacy patient)
- [ ] `RegisterDto` 수정(+patientDisplayName, +patientModePin, role/patientId 제거)
- [ ] `AuthService.register()` 트랜잭션(manager 사용) + UNIQUE catch→409 + PIN 해시 + 테스트(1·2)
- [ ] `AuthService.login()` 환자/무비번 조기 401 + 테스트(7)
- [ ] `POST /auth/patient-mode/verify-pin` + PIN 응답 누출 차단 + 테스트(10·11)

### Phase B: 프론트 — `[보통]`
- [ ] `AuthContext` isPatientMode(localStorage 영속) + enter/exitPatientMode(PIN 검증) + 테스트(front7)
- [ ] `App.tsx` PatientRoute/RootRedirect/CaregiverRoute 모드 인지 + 테스트(front1·2·3·6)
- [ ] CaregiverDashboard "환자 모드" 버튼 → enterPatientMode()
- [ ] PatientDashboard "보호자로 돌아가기" + PIN 모달 + 테스트(front5)
- [ ] LoginScreen 회원가입 재설계(+어르신 성함, +PIN, 역할 토글 제거) + 테스트(front4)

### Phase C: 검증 — `[쉬움]`
- [ ] dev `off` 모드로 신규 회원가입 → 보호자+환자 생성 확인(DB)
- [ ] 보호자 로그인 → 환자 모드 → 훈련 목록이 연결된 환자 데이터로 표시
- [ ] 환자 모드 → "보호자로 돌아가기" → PIN 입력 → 복귀 검증
- [ ] 브라우저 E2E 모드 왕복 + 스크린샷

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (FULL) | score 5/10 → 9/10, 4 decisions |
| Outside Voice | (eng review) | Cross-model challenge | 1 | issues_found (claude) | F2 critical→PIN 추가, F1/F3/F4/F6 반영, F5/F7 noted |

- **UNRESOLVED:** 0
- **VERDICT:** ENG + DESIGN CLEARED — 구현 준비 완료.
