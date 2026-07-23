# 환자 프로필 (가족 페르소나) Feature Plan

- 작성일: 2026-06-27
- 작성자: Claude Code (직접 설계)
- 참조 문서:
  - `docs/history/20260322_MemoryEntry_feature_plan.md`
  - `docs/history/20260322_AIService_feature_plan.md`
  - `docs/history/20260321_MemoryLink_implementation_plan.md`

---

## 목표 및 배경

환자의 **가족 관계**(아들=철수, 손자=민준, 배우자=영희 등)와 **배경**(고향,
직업, 취미, 의미 있는 장소)을 보호자가 한 번 등록해두면, 시나리오·퀴즈 생성 시
**개인화 컨텍스트**로 활용해 더 풍부하고 환자 자신의 기억에 밀착한 학습을 제공한다.

목표 결과 예시:
- (현재) "의자에 대해 이야기해볼까요?" — 사물 태그 기반의 일반적 질문
- (개선) "민준이와 함께 갔던 그곳을 떠올려 볼까요?" — 환자의 실제 가족·장소를 활용

### 현황과 문제

현재 시스템이 환자에 대해 가진 정보는 `User.displayName`(이름) 하나뿐이다.
가족 관계·배경을 담는 데이터 구조도, 정리한 문서도 없다.

더 큰 긴장 관계는 **마스킹 정책과의 충돌**이다. 현재 AI 서비스는 외부 LLM(Gemini)에
PII를 보내지 않으려고 이름·장소를 `Family_F1`, `Place_1`로 **익명화(제거)** 한다.
반면 본 기능은 가족 이름을 **활용(주입)** 하려 한다. 두 요구를 동시에 만족시키려면
**"외부 LLM에는 실명을 보내지 않되, 환자에게는 실명으로 보여주는"** 양방향 치환
전략이 필요하다.

### 핵심 아키텍처 결정 (요약)

| 결정 | 내용 |
|------|------|
| **PII 비노출 원칙 유지** | 외부 LLM(Gemini)에는 실명 대신 **관계 토큰**(`[손자1]`)만 전달 |
| **결정적 치환** | 프로필을 source of truth로, 실명↔토큰 매핑을 backend에서 결정적으로 생성 (휘발성 `entity_map`에 의존하지 않음) |
| **역치환 위치 = backend** | ai-service는 PII를 전혀 모르고, backend가 치환(생성 전)·역치환(환자 표시 전)을 모두 담당 |

### 구현 범위

| 서비스 | 구현 내용 |
|--------|-----------|
| NestJS 백엔드 | ProfileModule 신설 (PatientProfile, FamilyMember 엔티티/CRUD), 컨텍스트 치환·역치환 서비스, memory 시나리오 흐름 통합 |
| React 프론트엔드 | 보호자 온보딩/설정 화면(프로필·가족 등록), 도메인/훅/API 계층 |
| FastAPI 연동 | **변경 없음** — ai-service는 관계 토큰이 섞인 컨텍스트를 일반 텍스트로 처리 (PII 무지 유지) |

### 구현 제외 범위 (별도 계획)

- 프로필 자동 추출(사진/노트에서 가족 관계 추론) — 본 계획은 보호자 수동 입력만
- 퀴즈 생성 경로의 개인화 통합 — 본 계획은 **시나리오 경로 우선**, 퀴즈는 동일 패턴으로 후속 확장
- 다중 환자(한 보호자-여러 환자) — 현재 단일 환자 계정 모델 유지

---

## Phase 1: 컨텍스트 수집 결과

### 기존 코드 패턴 분석

**네이밍 컨벤션**
- TypeScript/NestJS: camelCase(변수·메서드), PascalCase(클래스·타입), kebab-case(파일명)
- 인터페이스 접두사 `I` (예: `IFastApiClient`, `ICryptoService`)
- NestJS DTO: `Create[Entity]Dto`, `Update[Entity]Dto`
- React Hook: `use[Feature][Action]`, 컴포넌트 파일 PascalCase

**폴더 구조 패턴**
- 백엔드: `src/[module]/{entities,dto,interfaces,services,errors,types}/` + 모듈 루트 controller/service/module
- 프론트엔드: `src/memory-link/[role]/{domain,application,infrastructure,presentation}/`

**암호화 패턴**
- 민감 텍스트는 `CryptoService.encrypt/decrypt`(AES-256-CBC, IV 접두) 사용
- `maskedContext`, `scenarioCache`는 암호화 상태로만 DB 저장
- DTO에 원문 미노출(`hasXxx: boolean`만 노출) — `memory-entry-response.dto.ts` 패턴

**에러 처리 패턴**
- 도메인 에러 열거형(`XxxErrorCode`) + 커스텀 에러 클래스 → 서비스에서 NestJS 예외로 변환
- React: `extractErrorMessage(err)` + `role="alert"`

### 기존 엔티티/흐름 현황

- `user.entity.ts`: `id, email, role(caregiver|patient|therapist), displayName, patientId(FK 자기참조)` — 보호자↔환자 연결 존재
- `memory-entry.entity.ts`: `maskedContext`, `scenarioCache`(암호화) 보유
- `patient-memory-note.entity.ts`: 보호자가 기록한 "환자분의 하루"(`answerText`) — 시나리오 컨텍스트의 핵심 텍스트 소스
- `memory.service.ts`:
  - `runTagAndMaskBestEffort(filename, noteTexts, memoryEntryId)` — 사진 태그 + 환자분의 하루를 결합해 `buildContext` → `/mask` → `maskedContext`
  - `triggerScenario(id, caregiverId)` — `maskedContext` 복호화 → `/scenario` → `scenarioCache` 암호화 저장
- `fast-api-client.service.ts`: `/tag`, `/mask`, `/scenario` 프록시
- ai-service `in_memory_masking_store.py`: `entity_map`을 인메모리 저장하나 **역치환 미사용·서버 재시작 시 소멸** → 본 기능은 이에 의존하지 않고 backend 결정적 매핑으로 대체

---

## Phase 2: 도메인 모델링

### 2-1. 엔티티 및 값 객체 정의

#### 엔티티: PatientProfile (환자당 1개)

```
식별자: id (UUID)

필드:
  - id: string (UUID PK)
  - patientId: string (UUID FK → users, UNIQUE)   # 환자당 1개 보장
  - caregiverId: string (UUID FK → users)         # 등록·수정 권한 소유 보호자
  - hometown: string | null                       # 고향/주요 거주지 (예: "강릉")
  - occupation: string | null                     # 직업/평생 직업 (예: "교사")
  - hobbies: string[]                             # 취미 (예: ["등산","바둑"])
  - significantPlaces: string[]                   # 의미 있는 장소 (예: ["○○공원","고향집"])
  - notes: string | null                          # 자유 서술 배경 (암호화 저장)
  - createdAt / updatedAt: Date

불변 조건:
  - patientId는 UNIQUE (환자당 프로필 1개)
  - caregiverId는 해당 patient에 연결된 보호자여야 함
  - hobbies / significantPlaces 각 최대 10개
  - notes는 암호화 상태로만 DB 저장 (PII 가능성)
```

#### 엔티티: FamilyMember (환자당 N개)

```
식별자: id (UUID)

필드:
  - id: string (UUID PK)
  - profileId: string (UUID FK → patient_profiles, onDelete CASCADE)
  - relation: FamilyRelation                      # 관계 (값 객체)
  - name: string                                  # 실명 (암호화 저장)
  - gender: 'M' | 'F' | 'U'
  - relationOrdinal: smallint                     # 동일 관계 내 구분 (아들1, 아들2)
  - note: string | null                           # 비고 (예: "서울 거주", 암호화)

불변 조건:
  - name은 암호화 상태로만 DB 저장
  - (profileId, relation, relationOrdinal) UNIQUE
  - relation은 FamilyRelation 허용값만
```

#### 값 객체: FamilyRelation

```
타입: 'spouse' | 'son' | 'daughter' | 'grandson' | 'granddaughter'
    | 'sibling' | 'friend' | 'other'

표시 라벨(한국어):
  spouse=배우자, son=아들, daughter=딸, grandson=손자,
  granddaughter=손녀, sibling=형제자매, friend=친구, other=기타

토큰 라벨(LLM 전달용): 관계+서수 → "[아들1]", "[손자2]"
불변 조건: 위 8개 값 외 불허
```

#### 값 객체: PersonaToken (치환 단위 — backend 내부)

```
필드:
  - token: string        # LLM에 노출되는 안전 토큰 (예: "[손자1]")
  - realName: string     # 환자에게 노출되는 실명 (예: "민준")

규칙:
  - token은 프로필로부터 결정적으로 생성 (relation + relationOrdinal)
  - 매핑은 backend 메모리 내에서만 생성·소비, ai-service로 realName 전송 금지
```

### 2-2. 유스케이스 정의

#### UC-1: UpsertPatientProfile (프로필 등록/수정)

```
Actor: 보호자
사전 조건: JWT 인증, 본인 연결 환자 존재
정상 흐름:
  1. 보호자가 hometown/occupation/hobbies/significantPlaces/notes 입력
  2. patientId 기준 upsert (없으면 생성, 있으면 갱신)
  3. notes는 암호화 저장
  4. PatientProfileResponseDto 반환 (notes 원문 미노출)
예외 흐름:
  - 인증 실패 401 / 연결 환자 불일치 403 / 검증 실패 400
```

#### UC-2: ManageFamilyMembers (가족 구성원 CRUD)

```
Actor: 보호자
정상 흐름:
  - 추가: relation/name/gender 입력 → relationOrdinal 자동 채번 → 암호화 저장
  - 수정/삭제: profile 소유권 검증 후 처리
예외 흐름: 401 / 403 / 400(허용되지 않은 relation)
사후 조건: family_members에 암호화된 name 저장
```

#### UC-3: GetPatientProfile (프로필 조회 — 보호자용)

```
Actor: 보호자
정상 흐름: patientId로 프로필 + 가족 목록 조회, name/notes 복호화하여 보호자에게 표시
예외 흐름: 401 / 403 / 404(미등록)
주의: 이 응답은 **보호자 전용**. 환자 공개 DTO에는 실명을 그대로 싣지 않는다.
```

#### UC-4: BuildPersonaContext (시나리오용 페르소나 컨텍스트 구성 — 내부)

```
Actor: 시스템 (memory.triggerScenario 내부 호출)
입력: patientId, baseContext(환자분의 하루 + 사진 태그)
정상 흐름:
  1. 환자 프로필·가족 목록 로드 (name 복호화)
  2. PersonaToken 매핑 생성: 가족 실명 → 관계 토큰 ("철수"→"[아들1]")
  3. baseContext 내 실명 출현을 토큰으로 결정적 치환 (긴 이름 우선)
  4. 프로필 배경(고향/취미/장소)을 컨텍스트에 부가 (장소도 필요 시 [장소n] 토큰화)
  5. 산출: { tokenizedContext, tokenMap }  # tokenMap은 호출자만 보유
예외 흐름:
  - 프로필 미등록: baseContext를 그대로 사용(개인화 생략, 기능 저하 없이 진행)
사후 조건: ai-service에는 tokenizedContext만 전달됨
```

#### UC-5: RestorePersonaText (역치환 — 내부)

```
Actor: 시스템 (환자에게 시나리오/질문 노출 직전)
입력: tokenizedText(LLM 산출물), tokenMap
정상 흐름: 텍스트 내 토큰("[손자1]")을 realName("민준")으로 복원
예외 흐름: 매핑에 없는 토큰은 관계 라벨("손자")로 폴백 (실명 누락 방지)
사후 조건: 환자에게는 실명이 보임. 외부로 나간 적은 없음.
```

### 2-3. 인터페이스 정의

```typescript
// backend/src/profile/interfaces/IPersonaContextService.ts

export interface PersonaContextResult {
  tokenizedContext: string;        // LLM 전달용 (실명 없음)
  tokenMap: Record<string, string>; // token -> realName (호출자만 보유, 영속 금지)
}

export interface IPersonaContextService {
  /** baseContext의 실명을 관계 토큰으로 치환 + 프로필 배경 부가 */
  buildPersonaContext(
    patientId: string,
    baseContext: string,
  ): Promise<PersonaContextResult>;

  /** LLM 산출물의 토큰을 실명으로 역치환 (미매핑 토큰은 관계 라벨 폴백) */
  restorePersonaText(
    tokenizedText: string,
    tokenMap: Record<string, string>,
  ): string;
}
```

---

## Phase 3: 레이어별 설계

### 3-1. 도메인 레이어

```typescript
// backend/src/profile/constants/profile.constants.ts
export const VALID_FAMILY_RELATIONS = [
  'spouse','son','daughter','grandson','granddaughter','sibling','friend','other',
] as const;
export const FAMILY_RELATION_LABELS: Record<FamilyRelation, string> = {
  spouse:'배우자', son:'아들', daughter:'딸', grandson:'손자',
  granddaughter:'손녀', sibling:'형제자매', friend:'친구', other:'기타',
};
export const MAX_HOBBIES = 10;
export const MAX_SIGNIFICANT_PLACES = 10;
export const MAX_FAMILY_MEMBERS = 20;
```

```typescript
// backend/src/profile/errors/profile.errors.ts
export enum ProfileErrorCode {
  NOT_FOUND = 'PROFILE_NOT_FOUND',
  FORBIDDEN = 'PROFILE_FORBIDDEN',
  INVALID_RELATION = 'INVALID_FAMILY_RELATION',
  LIMIT_EXCEEDED = 'PROFILE_LIMIT_EXCEEDED',
  PATIENT_LINK_MISMATCH = 'PATIENT_LINK_MISMATCH',
}
export class ProfileError extends Error {
  constructor(public readonly code: ProfileErrorCode, message: string) {
    super(message); this.name = 'ProfileError';
  }
}
```

### 3-2. 애플리케이션 레이어

```typescript
// backend/src/profile/dto/patient-profile-response.dto.ts
export class FamilyMemberResponseDto {
  id: string;
  relation: FamilyRelation;
  relationLabel: string;   // 한국어 라벨
  name: string;            // 보호자 전용 응답에서만 복호화 노출
  gender: 'M' | 'F' | 'U';
  note: string | null;
}
export class PatientProfileResponseDto {
  patientId: string;
  hometown: string | null;
  occupation: string | null;
  hobbies: string[];
  significantPlaces: string[];
  hasNotes: boolean;       // notes 원문은 미노출
  family: FamilyMemberResponseDto[];
  updatedAt: string;
}
```

```typescript
// backend/src/profile/profile.service.ts (요지)
@Injectable()
export class ProfileService {
  // upsertProfile / getProfile / addFamilyMember / updateFamilyMember / removeFamilyMember
  // - 소유권 검증(caregiver.patientId === patientId)
  // - name/notes는 CryptoService로 암복호화
}
```

```typescript
// backend/src/profile/services/persona-context.service.ts (핵심)
@Injectable()
export class PersonaContextService implements IPersonaContextService {
  constructor(
    private readonly profileService: ProfileService,
    private readonly cryptoService: CryptoService,
  ) {}

  async buildPersonaContext(patientId, baseContext) {
    // 1) 프로필+가족 로드(복호화). 미등록이면 { tokenizedContext: baseContext, tokenMap: {} }
    // 2) 가족별 토큰 생성: relation+relationOrdinal → "[아들1]" / tokenMap["[아들1]"]="철수"
    // 3) baseContext에서 실명을 긴 것부터 토큰으로 치환
    // 4) 프로필 배경을 컨텍스트 말미에 부가: "배경: 고향=[장소], 취미=등산, ..."
    // 5) return { tokenizedContext, tokenMap }
  }

  restorePersonaText(tokenizedText, tokenMap) {
    // 토큰 → realName. 미매핑 토큰은 관계 라벨로 폴백.
  }
}
```

### 3-3. 인프라스트럭처 레이어

```typescript
// backend/src/profile/entities/patient-profile.entity.ts  [NEW]
// backend/src/profile/entities/family-member.entity.ts     [NEW]
//  - name/notes는 평문 컬럼이되 서비스 레이어에서 암복호화 (memory의 maskedContext와 동일 패턴)
//  - patient_profiles.patient_id UNIQUE 제약
```

```typescript
// backend/src/profile/profile.module.ts  [NEW]
//  - TypeOrmModule.forFeature([PatientProfile, FamilyMember])
//  - CryptoService 재사용 (memory 모듈에서 export 또는 shared로 승격)
//  - ProfileService, PersonaContextService, ProfileController 등록
//  - PersonaContextService를 export (MemoryModule이 주입)
```

### 3-4. memory 시나리오 흐름 통합 (MODIFY)

```typescript
// backend/src/memory/memory.service.ts (triggerScenario 수정 요지)
//  기존: decrypt(maskedContext) → fastApiClient.generateScenario(...) → encrypt 저장
//  변경:
//    1. baseContext = decrypt(maskedContext)
//    2. { tokenizedContext, tokenMap } = personaContext.buildPersonaContext(patientId, baseContext)
//    3. scenario = fastApiClient.generateScenario(tokenizedContext, targetWords, emotionTag, id)
//    4. restored = {
//         openingQuestion: personaContext.restorePersonaText(scenario.openingQuestion, tokenMap),
//         ...(sceneDescription 등도 역치환)
//       }
//    5. encrypt(JSON.stringify(restored)) 저장
//
//  ※ MemoryModule에 ProfileModule import 추가, PersonaContextService 주입
//  ※ 대안(결정-3): 역치환을 "저장 시"가 아니라 "환자 표시 시"로 미룰 수 있음 (아래 결정 사항)
```

### 3-5. 프레젠테이션 레이어 (프론트엔드)

```
frontend/src/memory-link/caregiver/
├── domain/PatientProfile.ts           [NEW] FamilyRelation, 라벨, 타입
├── infrastructure/PatientProfileApi.ts[NEW] CRUD API
├── application/usePatientProfile.ts   [NEW] 조회/저장/가족 관리 훅
└── presentation/
    ├── ProfileScreen.tsx              [NEW] 프로필 + 가족 구성원 편집 화면
    └── CaregiverDashboard.tsx         [MODIFY] 프로필 진입점 추가
```

---

## Phase 4: 의존성 그래프 및 데이터 흐름

### 4-1. 모듈 의존성

```
ProfileModule
  ├── ProfileController → ProfileService → Repository<PatientProfile|FamilyMember>, CryptoService
  └── PersonaContextService (exported) → ProfileService, CryptoService

MemoryModule
  └── MemoryEntryService → PersonaContextService(주입), FastApiClientService, CryptoService
```

### 4-2. 시나리오 생성 데이터 흐름 (PII 경계 명시)

```
[보호자] 프로필 등록(실명) ──→ [ProfileService] AES 암호화 ──→ PostgreSQL

[시나리오 트리거]
  MemoryEntryService.triggerScenario
    1. baseContext = decrypt(maskedContext)                 (backend 내부, 실명 가능)
    2. buildPersonaContext → tokenizedContext("[손자1]..."), tokenMap
         └─ tokenMap("[손자1]"→"민준")은 backend 메모리에만 존재
    3. ───→ [FastAPI /scenario]  ❰ tokenizedContext만 전송 — 실명 없음 ❱
    4. ←─── opening_question("[손자1]와 함께...")
    5. restorePersonaText → "민준이와 함께..."               (backend 내부)
    6. encrypt 저장 / 또는 표시 시 역치환(결정-3)

[환자] 시나리오 열람 ──→ 실명("민준") 표시
```

**PII 경계**: 실명은 `① DB(암호화)`, `② backend 프로세스 메모리`에만 존재.
외부 LLM·로그·환자 공개 DTO(보호자용 제외)에는 토큰/마스킹 형태로만 노출.

### 4-3. API 명세 (신규 엔드포인트)

```
GET    /patient-profile            보호자: 프로필+가족 조회 (실명 복호화)
PUT    /patient-profile            보호자: 프로필 upsert
POST   /patient-profile/family     보호자: 가족 추가
PATCH  /patient-profile/family/:id 보호자: 가족 수정
DELETE /patient-profile/family/:id 보호자: 가족 삭제
(모두 @UseGuards(JwtAuthGuard), 보호자 역할 + 소유권 검증)
```

---

## Phase 5: 테스트 전략

### 5-1. 단위 테스트 (Jest)

```
[PersonaContextService.buildPersonaContext]
Given: 가족 {아들:철수, 손자:민준} + baseContext "철수랑 민준이랑 바다 갔어"
When : buildPersonaContext(patientId, baseContext)
Then : tokenizedContext에 "철수"/"민준" 미포함, "[아들1]"/"[손자1]" 포함
       tokenMap["[손자1]"]==="민준"

Given: 프로필 미등록 환자
When : buildPersonaContext 호출
Then : tokenizedContext === baseContext, tokenMap === {} (개인화 생략, 에러 없음)

Given: 부분 문자열 충돌 ("영희"와 "영희자"가 동시 존재)
When : 치환 수행
Then : 긴 이름 우선 치환으로 오치환 없음

[PersonaContextService.restorePersonaText]
Given: "[손자1]와 함께", tokenMap{"[손자1]":"민준"}
When : restorePersonaText
Then : "민준와 함께"  (조사 보정은 범위 외)

Given: 매핑에 없는 "[아들2]"
When : restorePersonaText
Then : 관계 라벨 "아들"로 폴백 (토큰 잔존 금지)

[ProfileService]
Given: 타 보호자의 patientId
When : getProfile/upsert
Then : ProfileError(FORBIDDEN)

Given: name="민준" 저장 후 조회
When : 저장 컬럼 직접 확인
Then : 평문 "민준"이 DB에 없음 (암호문), 조회 시 복호화되어 "민준"
```

### 5-2. 통합 테스트

```
[memory.triggerScenario + persona]
Given: 프로필 등록된 환자 + maskedContext 존재 엔트리
When : POST /memory-entries/:id/scenario (FastApiClient mock: tokenized 입력 echo)
Then : FastApiClient에 전달된 masked_context에 실명 미포함(토큰만),
       저장된 scenarioCache 복호화 시 실명 복원됨

[프로필 미노출 검증]
Given: 환자 공개 시나리오 응답 경로
When : 응답 직렬화
Then : tokenMap·notes 원문 미포함
```

### 5-3. 테스트 더블

| 대상 | 종류 | 이유 |
|------|------|------|
| FastApiClientService | Mock | 전달 컨텍스트(토큰화 여부) 검증 |
| CryptoService | 실제 | 암복호화 왕복 정확성 (또는 Stub) |
| Repository | Stub | 고정 프로필 응답 |

---

## Phase 6: 위험 요소 및 기술 부채

### 6-1. 기술적 위험 요소

| 위험 | 가능성 | 영향 | 대응 |
|------|:----:|:----:|------|
| 토큰 치환 누락(실명이 LLM에 새어나감) | 보통 | 높음 | 치환 후 `tokenizedContext`에 실명 잔존 검사(assert), 잔존 시 LLM 호출 차단 + 폴백 마스킹 |
| 부분 문자열 오치환("영희"⊂"영희자") | 보통 | 보통 | 이름을 길이 내림차순으로 치환, 단어 경계 고려 |
| 동명이인/별칭 | 낮음 | 보통 | relationOrdinal로 구분, 별칭은 notes에 보관(치환 대상 외) |
| 역치환 후 한국어 조사 부자연("민준와") | 높음 | 낮음 | 1차 허용(가독 무리 없음), 후속 조사 보정 유틸 검토 |
| 실명 평문 로깅 | 낮음 | 높음 | persona 경로 로깅 금지, baseContext/tokenMap 로그 출력 차단 |
| ai-service가 토큰을 깨뜨림(요약/변형) | 보통 | 보통 | 토큰 형식을 `[관계N]`처럼 단순·고유하게, 프롬프트에 "대괄호 토큰 보존" 명시 |
| 프로필 미등록 시 기능 저하 | 높음 | 낮음 | 미등록이면 개인화 생략하고 기존 흐름 유지(무중단) |

### 6-2. SOLID 점검

- **S**: ProfileService(영속·암복호), PersonaContextService(치환 로직), MemoryEntryService(흐름 조율) 책임 분리
- **O**: 새 FamilyRelation 추가 시 상수만 수정
- **D**: MemoryEntryService는 `IPersonaContextService`에 의존(구현체 직접 import 금지), NestJS DI 주입
- **I**: IPersonaContextService는 build/restore 2개 메서드로 최소화

### 6-3. 확장성

- **퀴즈 개인화**: quiz 생성 경로에서도 동일하게 `buildPersonaContext`/`restorePersonaText` 재사용
- **자동 프로필 추출**: 사진/노트에서 가족 관계 추론 시 ProfileService.upsert만 호출(치환 로직 불변)
- **다중 환자**: patientId 파라미터화되어 있어 보호자-환자 N:M 확장 시 영향 최소

---

## Phase 7: 산출물

### 7-1. 파일 구조

```
backend/src/
├── app.module.ts                                   [MODIFY] ProfileModule import
├── memory/
│   ├── memory.module.ts                            [MODIFY] ProfileModule import (PersonaContextService 주입)
│   └── memory.service.ts                           [MODIFY] triggerScenario에 persona build/restore 통합
└── profile/                                         [NEW 모듈]
    ├── constants/profile.constants.ts              [NEW]
    ├── errors/profile.errors.ts                    [NEW]
    ├── entities/patient-profile.entity.ts          [NEW]
    ├── entities/family-member.entity.ts            [NEW]
    ├── dto/upsert-patient-profile.dto.ts           [NEW]
    ├── dto/family-member-input.dto.ts              [NEW]
    ├── dto/patient-profile-response.dto.ts         [NEW]
    ├── interfaces/IPersonaContextService.ts        [NEW]
    ├── services/persona-context.service.ts         [NEW]
    ├── profile.service.ts                          [NEW]
    ├── profile.controller.ts                       [NEW]
    └── profile.module.ts                           [NEW]

frontend/src/memory-link/caregiver/
├── domain/PatientProfile.ts                        [NEW]
├── infrastructure/PatientProfileApi.ts             [NEW]
├── application/usePatientProfile.ts                [NEW]
└── presentation/
    ├── ProfileScreen.tsx                           [NEW]
    └── CaregiverDashboard.tsx                      [MODIFY] 프로필 진입점
```

### 7-2. 구현 체크리스트

```
### 준비
- [ ] [쉬움] CryptoService를 ProfileModule에서 재사용 가능하도록 export/shared 정리

### Domain (backend)
- [ ] [쉬움] profile.constants.ts (relation 목록·라벨·상한)
- [ ] [쉬움] profile.errors.ts (ProfileErrorCode, ProfileError)
- [ ] [쉬움] IPersonaContextService.ts

### Infrastructure (backend)
- [ ] [쉬움] patient-profile.entity.ts (patient_id UNIQUE)
- [ ] [쉬움] family-member.entity.ts (CASCADE, UNIQUE(profile,relation,ordinal))
- [ ] [보통] profile.module.ts (forFeature, Crypto, providers, PersonaContextService export)
- [ ] [쉬움] app.module.ts에 ProfileModule 등록

### Application (backend)
- [ ] [쉬움] DTO 3종 (upsert, family-input, response — name/notes 노출 정책 반영)
- [ ] [보통] profile.service.ts (upsert/get/family CRUD + 암복호 + 소유권 검증)
- [ ] [어려움] persona-context.service.ts
  - [ ] buildPersonaContext: 토큰 생성·치환·배경 부가·실명 잔존 검사
  - [ ] restorePersonaText: 역치환 + 미매핑 폴백

### Presentation (backend)
- [ ] [보통] profile.controller.ts (GET/PUT /patient-profile, family CRUD, JwtAuthGuard)

### memory 통합 (backend)
- [ ] [보통] memory.service.triggerScenario에 persona build/restore 삽입
- [ ] [쉬움] memory.module.ts ProfileModule import

### Frontend
- [ ] [쉬움] domain/PatientProfile.ts (relation/라벨/타입)
- [ ] [보통] infrastructure/PatientProfileApi.ts (CRUD)
- [ ] [보통] application/usePatientProfile.ts
- [ ] [보통] presentation/ProfileScreen.tsx (프로필+가족 편집)
- [ ] [쉬움] CaregiverDashboard.tsx 진입점

### Tests
- [ ] [보통] PersonaContextService 단위(치환/역치환/미등록/오치환/잔존검사)
- [ ] [보통] ProfileService 단위(암복호 왕복·소유권)
- [ ] [보통] triggerScenario 통합(토큰만 전달·복원 저장)
```

---

## 미결 결정 사항 (구현 착수 전 확정 필요)

### [결정-1] 실명 저장 방식: 컬럼 암호화 vs 별도 보안 저장소
- **옵션 A (권장)**: 기존 `CryptoService`(AES-256-CBC)로 `name`/`notes` 컬럼 암호화 — memory 모듈과 동일 패턴, 추가 인프라 불필요
- 옵션 B: pgcrypto/별도 KMS — 보안 강화하나 MVP 과설계
- 영향: 옵션 A 채택 시 ProfileService가 CryptoService 주입

### [결정-2] LLM 전달 시 실명 노출 정책 (PII 경계)
- **옵션 A (권장)**: 실명을 외부 LLM에 **절대 전송 금지** → 관계 토큰만 전달 + 역치환 (본 문서 기본 가정)
- 옵션 B: 온프레미스/신뢰 LLM 한정으로 실명 직접 주입 (역치환 불필요, 단순)
- 영향: A는 PersonaContextService 필수, B는 build/restore 생략 가능. **의료 데이터 특성상 A 강력 권장**

### [결정-3] 역치환 시점: 저장 시 vs 환자 표시 시
- 옵션 A: `triggerScenario`에서 역치환 후 **실명 상태로 scenarioCache 저장**(암호화) — 구현 단순, 표시 경로 무변경
- **옵션 B (권장)**: scenarioCache는 **토큰 상태로 저장**, 환자 표시(training) 직전 역치환 — DB에도 실명 미저장으로 PII 노출면 최소화. 단 표시 경로가 프로필 접근 필요
- 영향: B 선택 시 training 조회 경로에 PersonaContextService 주입 + tokenMap 재생성(프로필 결정적이므로 재생성 가능)

### [결정-4] 장소(고향/의미있는 장소)도 토큰화할지
- 옵션 A: 인물만 토큰화, 장소는 마스킹(`/mask`)에 위임
- **옵션 B (권장)**: 장소도 `[장소n]` 토큰화하여 역치환 → "강릉" 같은 실제 지명을 환자에게 정확히 노출
- 영향: B는 buildPersonaContext에 significantPlaces/hometown 매핑 추가
