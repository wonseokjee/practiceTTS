# 메모리 엔트리 (Memory Entry) Feature Plan

- 작성일: 2026-03-22
- 작성자: Feature Architect Agent
- 참조 문서:
  - `docs/history/20260321_MemoryLink_implementation_plan.md`
  - `docs/history/20260322_AIService_feature_plan.md`

---

## 목표 및 배경

보호자가 환자의 라이프 로그(사진 + 감정태그 + 목표단어)를 등록하고,
AI 태깅 → PII 마스킹 → 시나리오 생성 트리거까지의 전체 플로우를 구현한다.

이 기능은 Memory Link 플랫폼의 보호자 측 핵심 기능으로,
훈련 세션에서 사용될 개인화 컨텍스트(maskedContext, scenarioCache)를 준비하는 역할을 담당한다.

### 구현 범위

| 서비스 | 구현 내용 |
|--------|-----------|
| NestJS 백엔드 | MemoryModule 완성 (Controller, Service, Repository, Module) |
| React 프론트엔드 | 보호자 캡처 플로우 화면 및 Hook 구현 |
| FastAPI 연동 | /tag, /mask, /scenario 엔드포인트 호출 (NestJS가 프록시) |

### 구현 제외 범위 (별도 계획)

- 환자 훈련 세션 (`/training/*`) 플로우
- FastAPI AI 서비스 내부 구현 (20260322_AIService_feature_plan.md 참조)

---

## Phase 1: 컨텍스트 수집 결과

### 기존 코드 패턴 분석

**네이밍 컨벤션**
- TypeScript/NestJS: camelCase (변수, 메서드), PascalCase (클래스, 인터페이스, 타입), kebab-case (파일명)
- 인터페이스 접두사: `I` (예: `IMemoryEntryRepository`)
- NestJS DTO: `Create[Entity]Dto`, `Update[Entity]Dto` 패턴
- React Hook: `use[Feature][Action]` (예: `useMemoryEntries`, `useCaptureFlow`)
- React 컴포넌트 파일: PascalCase (예: `CaptureScreen.tsx`)

**폴더 구조 패턴**
- 백엔드: `src/[module]/entities/`, `src/[module]/dto/`, 모듈 루트에 controller/service/module
- 프론트엔드: `src/memory-link/[role]/domain/`, `application/`, `infrastructure/`, `presentation/`

**에러 처리 패턴 (NestJS)**
- 타입이 있는 예외 클래스 사용: `NotFoundException`, `ForbiddenException`, `ConflictException`
- 도메인별 커스텀 에러 열거형 + NestJS 예외 클래스 조합
- 컨트롤러에서 예외를 직접 throw하지 않고 서비스 레이어에서 처리

**에러 처리 패턴 (React)**
- try/catch 내부에서 에러 상태 업데이트
- `extractErrorMessage(err: unknown): string` 패턴으로 타입 안전 에러 추출
- UI에서 `role="alert"` 접근성 속성 포함

**상태 관리 패턴**
- 인증 상태: React Context (`AuthContext`) + `useState`
- 비즈니스 데이터: Zustand 또는 커스텀 훅 내부 `useState` (기존 assessments 패턴)
- 서버 상태: Axios 직접 호출 + 훅 내부 상태 관리

**기존 엔티티 현황**
- `memory-entry.entity.ts`: 이미 정의됨 (photoUrl, locationTag, objectTags, emotionTag, targetWords, maskedContext, scenarioCache, isActive 포함)
- `user.entity.ts`: 이미 정의됨 (caregiver/patient/therapist role, patientId FK)
- `create-memory-entry.dto.ts`, `update-memory-entry.dto.ts`: 기본 구조 정의됨 (확장 필요)

**기존 프론트엔드 현황**
- `MemoryLinkApi.ts`: Axios 인스턴스 (JWT 자동 주입, 401 리다이렉트) 완성
- `AuthContext.tsx`: 로그인/로그아웃/복원 완성
- `CaregiverDashboard.tsx`: 플레이스홀더만 존재 → 교체 필요

---

## Phase 2: 도메인 모델링

### 2-1. 엔티티 및 값 객체 정의

#### 엔티티: MemoryEntry

```
식별자: id (UUID)
상태 변화: draft → tagged → masked → scenario_ready

필드:
  - id: string (UUID PK)
  - caregiverId: string (UUID FK → users)
  - patientId: string (UUID FK → users)
  - photoUrl: string | null          # 업로드된 이미지 경로
  - locationTag: string | null       # AI 자동 태깅: 장소 (예: "공원")
  - objectTags: string[] | null      # AI 자동 태깅: 사물 목록 (예: ["강아지", "벤치"])
  - emotionTag: EmotionTag | null    # 보호자 입력: happy | calm | nostalgic | excited
  - targetWords: string[]            # 보호자 입력: 훈련 목표 단어 (최대 3개)
  - maskedContext: string | null     # AI 마스킹 처리된 컨텍스트 텍스트 (AES-256 암호화 저장)
  - scenarioCache: string | null     # 시나리오 생성 JSON 캐시 (AES-256 암호화 저장)
  - isActive: boolean                # 소프트 삭제 플래그
  - createdAt: Date

불변 조건:
  - caregiverId와 patientId는 필수값이며 빈 문자열 불가
  - targetWords는 최대 3개 초과 불가
  - emotionTag는 허용된 값(happy, calm, nostalgic, excited)만 가능
  - maskedContext와 scenarioCache는 암호화 상태로만 DB에 저장
  - photoUrl이 없으면 locationTag, objectTags를 설정할 수 없음

생성 조건:
  - 보호자(caregiver) 역할의 사용자만 생성 가능
  - patientId는 해당 보호자가 연결된 환자의 ID여야 함
```

#### 값 객체: EmotionTag

```
타입: 'happy' | 'calm' | 'nostalgic' | 'excited'

의미:
  - happy: 행복했던 기억
  - calm: 평온했던 기억
  - nostalgic: 그리운 기억
  - excited: 설레는 기억

불변 조건: 위 4개 값 외 불허
```

#### 값 객체: AiTagResult (FastAPI /tag 응답)

```
필드:
  - locationTag: string     # 장소 태그
  - objectTags: string[]    # 사물 태그 목록

불변 조건:
  - locationTag는 빈 문자열 불가
  - objectTags는 최소 0개, 최대 10개
```

#### 값 객체: AiMaskResult (FastAPI /mask 응답)

```
필드:
  - maskedText: string     # PII 마스킹 완료된 컨텍스트

불변 조건:
  - maskedText는 빈 문자열 불가
  - entity_map은 이 값 객체에 포함하지 않음 (NestJS 레벨에서 수신 즉시 폐기)
```

#### 값 객체: ScenarioCacheData (시나리오 캐시 내용)

```
필드:
  - openingQuestion: string   # 훈련 시작 질문

불변 조건:
  - openingQuestion은 목표 단어를 직접 포함하면 안 됨 (Guardrail 규칙)
```

### 2-2. 유스케이스 정의

#### UC-1: CreateMemoryEntry (메모리 엔트리 생성)

```
유스케이스명: CreateMemoryEntry
Actor: 보호자 (caregiver)

사전 조건:
  - JWT 인증된 보호자 사용자
  - 보호자 계정에 연결된 환자(patientId)가 존재
  - 업로드 파일이 이미지 형식 (JPEG, PNG, WEBP) 및 5MB 이하

정상 흐름:
  1. 보호자가 사진 + emotionTag + targetWords[] 를 multipart/form-data로 전송
  2. Multer가 이미지를 tts-cache/... 경로에 저장, photoUrl 확보
  3. MemoryEntry 레코드를 DB에 생성 (photoUrl, emotionTag, targetWords 저장)
  4. FastAPI POST /tag 호출 → locationTag, objectTags 수신 후 DB 업데이트
  5. 이미지에서 추출한 컨텍스트 텍스트 구성 (locationTag + objectTags 조합)
  6. FastAPI POST /mask 호출 → maskedContext 수신 후 AES-256 암호화하여 DB 저장
  7. 생성된 MemoryEntry DTO 반환

예외 흐름:
  - 인증 실패: 401 Unauthorized
  - 환자 ID가 본인 연결 환자와 불일치: 403 Forbidden
  - 파일 미첨부: 400 Bad Request ("사진은 필수입니다.")
  - 파일 형식 불일치: 400 Bad Request ("지원하지 않는 이미지 형식입니다.")
  - 파일 크기 초과: 400 Bad Request ("이미지 크기는 5MB 이하여야 합니다.")
  - targetWords 3개 초과: 400 Bad Request
  - FastAPI /tag 호출 실패: 엔트리를 저장하되 locationTag=null, objectTags=null 유지 (부분 성공 허용)
  - FastAPI /mask 호출 실패: 엔트리를 저장하되 maskedContext=null 유지 (부분 성공 허용)

사후 조건:
  - memory_entries 테이블에 레코드 존재
  - photoUrl이 실제 저장 경로를 가리킴
  - AI 태깅 성공 시: locationTag, objectTags, maskedContext 저장됨
```

#### UC-2: GetMemoryEntries (목록 조회)

```
유스케이스명: GetMemoryEntries
Actor: 보호자 (caregiver)

사전 조건:
  - JWT 인증된 보호자 사용자

정상 흐름:
  1. 보호자 ID로 본인이 등록한 memory_entries 목록 조회 (isActive=true)
  2. 최신순 정렬 (createdAt DESC)
  3. 목록 DTO 배열 반환

예외 흐름:
  - 인증 실패: 401 Unauthorized

사후 조건:
  - 반환된 목록은 maskedContext, scenarioCache 필드 미포함 (보안)
```

#### UC-3: GetMemoryEntryDetail (단건 조회)

```
유스케이스명: GetMemoryEntryDetail
Actor: 보호자 (caregiver)

사전 조건:
  - JWT 인증된 보호자 사용자
  - 해당 ID의 엔트리가 존재하고 isActive=true

정상 흐름:
  1. id로 memory_entries 조회
  2. caregiverId가 요청자와 일치하는지 검증
  3. 상세 DTO 반환 (scenarioCache 미포함)

예외 흐름:
  - 인증 실패: 401 Unauthorized
  - 엔트리 미존재 또는 isActive=false: 404 Not Found
  - 본인 소유 아님: 403 Forbidden
```

#### UC-4: UpdateMemoryEntry (수정)

```
유스케이스명: UpdateMemoryEntry
Actor: 보호자 (caregiver)

사전 조건:
  - JWT 인증된 보호자 사용자
  - 해당 ID의 엔트리가 존재하고 isActive=true
  - 본인 소유 엔트리

정상 흐름:
  1. id로 엔트리 조회 및 소유권 검증
  2. emotionTag, targetWords 업데이트 (photo는 수정 불가)
  3. targetWords 변경 시 scenarioCache 무효화 (null로 초기화)
  4. 업데이트된 엔트리 DTO 반환

예외 흐름:
  - 인증 실패: 401 Unauthorized
  - 엔트리 미존재: 404 Not Found
  - 본인 소유 아님: 403 Forbidden
  - 유효하지 않은 emotionTag: 400 Bad Request
```

#### UC-5: TriggerScenario (시나리오 생성 트리거)

```
유스케이스명: TriggerScenario
Actor: 보호자 (caregiver), 시스템 (비동기)

사전 조건:
  - JWT 인증된 보호자 사용자
  - 해당 엔트리의 maskedContext가 존재 (마스킹 완료 상태)
  - targetWords가 1개 이상 존재

정상 흐름:
  1. id로 엔트리 조회 및 소유권/상태 검증
  2. FastAPI POST /scenario 비동기 호출
     (body: { masked_context, target_words, hint_level: 0 })
  3. 응답 받은 openingQuestion을 ScenarioCacheData로 직렬화
  4. AES-256 암호화 후 scenarioCache 컬럼 업데이트
  5. { status: 'triggered' } 즉시 반환 (클라이언트는 폴링 또는 별도 조회)

예외 흐름:
  - 인증 실패: 401 Unauthorized
  - 엔트리 미존재: 404 Not Found
  - 본인 소유 아님: 403 Forbidden
  - maskedContext 없음: 422 Unprocessable Entity ("AI 태깅/마스킹이 완료되지 않았습니다.")
  - targetWords 없음: 422 Unprocessable Entity ("목표 단어를 1개 이상 등록해야 합니다.")
  - FastAPI /scenario 호출 실패: 502 Bad Gateway

사후 조건:
  - scenarioCache 컬럼에 암호화된 시나리오 JSON 저장
```

### 2-3. 레포지토리 인터페이스 정의

```typescript
// 파일: backend/src/memory/interfaces/IMemoryEntryRepository.ts

export interface IMemoryEntryRepository {
  create(data: CreateMemoryEntryData): Promise<MemoryEntry>;
  findAllByCaregiver(caregiverId: string): Promise<MemoryEntry[]>;
  findById(id: string): Promise<MemoryEntry | null>;
  update(id: string, data: Partial<UpdateMemoryEntryData>): Promise<MemoryEntry>;
  softDelete(id: string): Promise<void>;
}

export interface CreateMemoryEntryData {
  caregiverId: string;
  patientId: string;
  photoUrl: string;
  emotionTag?: EmotionTag;
  targetWords?: string[];
}

export interface UpdateMemoryEntryData {
  locationTag: string;
  objectTags: string[];
  emotionTag: EmotionTag;
  targetWords: string[];
  maskedContext: string;       // 암호화된 값
  scenarioCache: string | null; // 암호화된 값 또는 null (무효화 시)
}
```

```typescript
// 파일: backend/src/memory/interfaces/IFastApiClient.ts

export interface IFastApiClient {
  tag(imageUrl: string): Promise<AiTagResult>;
  mask(context: string): Promise<AiMaskResult>;
  generateScenario(
    maskedContext: string,
    targetWords: string[],
    hintLevel: 0 | 1 | 2,
  ): Promise<ScenarioCacheData>;
}
```

```typescript
// 파일: backend/src/memory/interfaces/ICryptoService.ts

export interface ICryptoService {
  encrypt(plainText: string): string;
  decrypt(cipherText: string): string;
}
```

---

## Phase 3: 레이어별 설계

### 3-1. 도메인 레이어

**위치**: `backend/src/memory/` (NestJS 모듈 내 도메인 개념 포함)

외부 의존성 없이 순수 비즈니스 규칙만 포함한다.

#### 도메인 상수 및 타입

```typescript
// backend/src/memory/constants/memory-entry.constants.ts
export const MAX_TARGET_WORDS = 3;
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const VALID_EMOTION_TAGS = ['happy', 'calm', 'nostalgic', 'excited'] as const;
```

#### 도메인 에러 타입

```typescript
// backend/src/memory/errors/memory-entry.errors.ts
export enum MemoryEntryErrorCode {
  NOT_FOUND = 'MEMORY_ENTRY_NOT_FOUND',
  FORBIDDEN = 'MEMORY_ENTRY_FORBIDDEN',
  INVALID_EMOTION_TAG = 'INVALID_EMOTION_TAG',
  TARGET_WORDS_LIMIT_EXCEEDED = 'TARGET_WORDS_LIMIT_EXCEEDED',
  PHOTO_REQUIRED = 'PHOTO_REQUIRED',
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  FILE_SIZE_EXCEEDED = 'FILE_SIZE_EXCEEDED',
  MASKING_NOT_COMPLETE = 'MASKING_NOT_COMPLETE',
  TARGET_WORDS_REQUIRED = 'TARGET_WORDS_REQUIRED',
  AI_SERVICE_UNAVAILABLE = 'AI_SERVICE_UNAVAILABLE',
}

export class MemoryEntryError extends Error {
  constructor(
    public readonly code: MemoryEntryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MemoryEntryError';
  }
}
```

### 3-2. 애플리케이션 레이어

#### DTO 정의

```typescript
// backend/src/memory/dto/create-memory-entry.dto.ts (MODIFY: 파일 첨부 주석 추가)
// 기존 구조 유지, 멀티파트 업로드 시 photo는 @UploadedFile()로 별도 처리

// backend/src/memory/dto/memory-entry-response.dto.ts [NEW]
export class MemoryEntryResponseDto {
  id: string;
  patientId: string;
  photoUrl: string | null;
  locationTag: string | null;
  objectTags: string[] | null;
  emotionTag: string | null;
  targetWords: string[];
  hasScenario: boolean;       // scenarioCache 존재 여부 (내용 미포함)
  hasMaskedContext: boolean;  // maskedContext 존재 여부
  createdAt: string;          // ISO 8601 문자열
}
// maskedContext, scenarioCache 원문은 절대 응답에 포함하지 않음

// backend/src/memory/dto/trigger-scenario-response.dto.ts [NEW]
export class TriggerScenarioResponseDto {
  status: 'triggered';
  memoryEntryId: string;
}
```

#### 서비스 인터페이스

```typescript
// backend/src/memory/interfaces/IMemoryEntryService.ts [NEW]

export interface IMemoryEntryService {
  create(
    caregiverId: string,
    dto: CreateMemoryEntryDto,
    photo: Express.Multer.File,
  ): Promise<MemoryEntryResponseDto>;

  findAll(caregiverId: string): Promise<MemoryEntryResponseDto[]>;

  findOne(id: string, caregiverId: string): Promise<MemoryEntryResponseDto>;

  update(
    id: string,
    caregiverId: string,
    dto: UpdateMemoryEntryDto,
  ): Promise<MemoryEntryResponseDto>;

  triggerScenario(
    id: string,
    caregiverId: string,
  ): Promise<TriggerScenarioResponseDto>;
}
```

#### 서비스 구현체 설계

```typescript
// backend/src/memory/memory.service.ts [NEW]

@Injectable()
export class MemoryEntryService implements IMemoryEntryService {
  constructor(
    @InjectRepository(MemoryEntry)
    private readonly memoryEntryRepository: Repository<MemoryEntry>,
    private readonly fastApiClient: FastApiClientService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
  ) {}

  async create(...): Promise<MemoryEntryResponseDto> {
    // 1. 소유권 검증 (caregiver.patientId === dto.patientId)
    // 2. DB 저장 (photo, emotionTag, targetWords)
    // 3. FastAPI /tag 호출 (실패 시 부분 성공 허용)
    // 4. FastAPI /mask 호출 (실패 시 부분 성공 허용, encrypt 후 저장)
    // 5. DTO 변환 후 반환
  }

  async triggerScenario(id: string, caregiverId: string): Promise<TriggerScenarioResponseDto> {
    // 1. 엔트리 조회 및 소유권 검증
    // 2. maskedContext 존재 여부 확인 (없으면 422)
    // 3. decrypt(maskedContext) 후 FastAPI /scenario 호출
    // 4. encrypt(JSON.stringify(scenarioData)) 후 DB 저장
    // 5. { status: 'triggered' } 반환
  }
}
```

### 3-3. 인프라스트럭처 레이어

#### TypeORM 엔티티 (기존 파일 수정)

```typescript
// backend/src/memory/entities/memory-entry.entity.ts [MODIFY]
// 기존 엔티티 구조는 완성되어 있음
// 추가 필요 사항: @BeforeInsert/@BeforeUpdate 암호화 로직은
// 서비스 레이어에서 처리 (단순성 우선, subscriber 복잡성 회피)
```

#### FastAPI 클라이언트 서비스

```typescript
// backend/src/memory/services/fast-api-client.service.ts [NEW]

@Injectable()
export class FastApiClientService implements IFastApiClient {
  private readonly baseUrl: string;

  constructor(
    private readonly httpService: HttpService,  // @nestjs/axios
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get<string>('FASTAPI_URL', 'http://localhost:8000');
  }

  async tag(imageUrl: string): Promise<AiTagResult> {
    // POST {baseUrl}/tag 호출
    // 실패 시 MemoryEntryError(AI_SERVICE_UNAVAILABLE) throw
  }

  async mask(context: string): Promise<AiMaskResult> {
    // POST {baseUrl}/mask 호출
    // entity_map은 응답에서 수신하더라도 즉시 폐기, maskedText만 반환
  }

  async generateScenario(...): Promise<ScenarioCacheData> {
    // POST {baseUrl}/scenario 호출
  }
}
```

#### 암호화 서비스

```typescript
// backend/src/memory/services/crypto.service.ts [NEW]

@Injectable()
export class CryptoService implements ICryptoService {
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const secret = this.configService.get<string>('CRYPTO_SECRET_KEY', '');
    // AES-256-CBC: 32바이트 키 필요
    this.key = crypto.scryptSync(secret, 'salt', 32);
  }

  encrypt(plainText: string): string {
    // AES-256-CBC 암호화, IV를 결과 앞에 접두사로 포함 (iv:ciphertext 형식)
    // Node.js crypto 모듈 사용
  }

  decrypt(cipherText: string): string {
    // iv:ciphertext 형식을 파싱하여 복호화
  }
}
// 교체 가능성: ICryptoService 인터페이스를 구현하므로
// pgcrypto 직접 사용 방식으로 교체 시 이 클래스만 교체
```

#### 파일 저장 서비스

```typescript
// backend/src/memory/services/file-storage.service.ts [NEW]

@Injectable()
export class FileStorageService {
  private readonly uploadDir: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir = this.configService.get<string>(
      'UPLOAD_DIR',
      'tts-cache/memory-images',
    );
  }

  getPublicUrl(filename: string): string {
    // 업로드 경로를 공개 URL로 변환 (예: /uploads/memory-images/파일명)
  }
}
// 교체 가능성: Phase 2에서 Azure Blob 또는 S3로 교체 시
// getPublicUrl() 구현만 변경하면 됨. photoUrl 추상화 유지.
```

### 3-4. 프레젠테이션 레이어

#### NestJS 컨트롤러

```typescript
// backend/src/memory/memory.controller.ts [NEW]

@Controller('memory-entries')
@UseGuards(JwtAuthGuard)
export class MemoryController {
  constructor(private readonly memoryEntryService: MemoryEntryService) {}

  @Post()
  @UseInterceptors(FileInterceptor('photo'))
  async create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateMemoryEntryDto,
    @UploadedFile(new ParseFilePipe({
      validators: [
        new MaxFileSizeValidator({ maxSize: MAX_PHOTO_SIZE_BYTES }),
        new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
      ],
    })) photo: Express.Multer.File,
  ): Promise<MemoryEntryResponseDto> { ... }

  @Get()
  async findAll(@Request() req: AuthenticatedRequest): Promise<MemoryEntryResponseDto[]> { ... }

  @Get(':id')
  async findOne(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MemoryEntryResponseDto> { ... }

  @Patch(':id')
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemoryEntryDto,
  ): Promise<MemoryEntryResponseDto> { ... }

  @Post(':id/scenario')
  async triggerScenario(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TriggerScenarioResponseDto> { ... }
}
```

#### React 도메인 타입 (프론트엔드)

```typescript
// frontend/src/memory-link/caregiver/domain/MemoryEntry.ts [NEW]

export type EmotionTag = 'happy' | 'calm' | 'nostalgic' | 'excited';

export const EMOTION_TAG_LABELS: Record<EmotionTag, string> = {
  happy: '행복한',
  calm: '평온한',
  nostalgic: '그리운',
  excited: '설레는',
};

export interface MemoryEntry {
  id: string;
  patientId: string;
  photoUrl: string | null;
  locationTag: string | null;
  objectTags: string[] | null;
  emotionTag: EmotionTag | null;
  targetWords: string[];
  hasScenario: boolean;
  hasMaskedContext: boolean;
  createdAt: string;
}

export interface CreateMemoryEntryRequest {
  patientId: string;
  emotionTag?: EmotionTag;
  targetWords?: string[];
  photo: File;
}

export interface UpdateMemoryEntryRequest {
  emotionTag?: EmotionTag;
  targetWords?: string[];
}
```

#### React API 계층 (인프라스트럭처)

```typescript
// frontend/src/memory-link/caregiver/infrastructure/MemoryEntryApi.ts [NEW]

export interface IMemoryEntryApi {
  create(data: CreateMemoryEntryRequest): Promise<MemoryEntry>;
  getAll(): Promise<MemoryEntry[]>;
  getById(id: string): Promise<MemoryEntry>;
  update(id: string, data: UpdateMemoryEntryRequest): Promise<MemoryEntry>;
  triggerScenario(id: string): Promise<{ status: string; memoryEntryId: string }>;
}

export const memoryEntryApi: IMemoryEntryApi = {
  async create(data) {
    const formData = new FormData();
    formData.append('photo', data.photo);
    formData.append('patientId', data.patientId);
    if (data.emotionTag) formData.append('emotionTag', data.emotionTag);
    if (data.targetWords) {
      data.targetWords.forEach((w) => formData.append('targetWords', w));
    }
    const res = await memoryLinkApi.post<MemoryEntry>('/memory-entries', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },
  // ...
};
```

#### React 애플리케이션 훅

```typescript
// frontend/src/memory-link/caregiver/application/useMemoryEntries.ts [NEW]

export interface UseMemoryEntriesReturn {
  entries: MemoryEntry[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  triggerScenario: (id: string) => Promise<void>;
  scenarioStatus: Record<string, 'idle' | 'pending' | 'done' | 'error'>;
}

export function useMemoryEntries(): UseMemoryEntriesReturn { ... }
```

```typescript
// frontend/src/memory-link/caregiver/application/useCaptureFlow.ts [NEW]

export type CaptureStep = 'photo' | 'emotion' | 'words' | 'submitting' | 'done';

export interface UseCaptureFlowReturn {
  step: CaptureStep;
  photoPreview: string | null;
  emotionTag: EmotionTag | null;
  targetWords: string[];          // 최대 3개
  error: string | null;
  isSubmitting: boolean;
  setPhoto: (file: File) => void;
  setEmotionTag: (tag: EmotionTag) => void;
  addTargetWord: (word: string) => void;
  removeTargetWord: (word: string) => void;
  submit: () => Promise<void>;
  reset: () => void;
}

export function useCaptureFlow(patientId: string): UseCaptureFlowReturn { ... }
```

#### React 화면 컴포넌트

```
// frontend/src/memory-link/caregiver/presentation/CaptureScreen.tsx [NEW]
// 3단계 스텝 UI: 사진 선택 → 감정 태그 선택 → 목표 단어 입력
// useCaptureFlow 훅 사용, 비즈니스 로직 없음

// frontend/src/memory-link/caregiver/presentation/EntryListScreen.tsx [NEW]
// 메모리 엔트리 목록 카드 UI
// useMemoryEntries 훅 사용

// frontend/src/memory-link/caregiver/presentation/EntryDetailScreen.tsx [NEW]
// 엔트리 상세 보기 + 시나리오 생성 트리거 버튼

// frontend/src/memory-link/caregiver/presentation/CaregiverDashboard.tsx [MODIFY]
// 플레이스홀더 → EntryListScreen + CaptureScreen 진입점으로 교체
```

---

## Phase 4: 의존성 그래프 및 인터페이스 명세

### 4-1. 의존성 다이어그램

#### 백엔드 (NestJS)

```
MemoryController
  └── MemoryEntryService
        ├── Repository<MemoryEntry>  (TypeORM, IMemoryEntryRepository 의미)
        ├── FastApiClientService     (IFastApiClient 구현체)
        │     └── HttpService        (@nestjs/axios)
        ├── CryptoService            (ICryptoService 구현체, Node.js crypto)
        └── ConfigService            (@nestjs/config)

MemoryModule
  ├── TypeOrmModule.forFeature([MemoryEntry])
  ├── HttpModule                     (@nestjs/axios)
  ├── AuthModule (JwtAuthGuard 재사용)
  └── ConfigModule (global)
```

#### 프론트엔드 (React)

```
CaptureScreen
  └── useCaptureFlow(patientId)
        └── memoryEntryApi.create()    (IMemoryEntryApi 구현체)
              └── memoryLinkApi        (Axios 인스턴스, JWT 자동 주입)

EntryListScreen
  └── useMemoryEntries()
        └── memoryEntryApi.getAll()
        └── memoryEntryApi.triggerScenario()

EntryDetailScreen
  └── useMemoryEntries()

CaregiverDashboard
  ├── useAuth()                        (AuthContext)
  ├── EntryListScreen
  └── CaptureScreen (모달 또는 라우팅)
```

#### 전체 서비스 간 의존성

```
[React 보호자 화면]
  └─── POST /memory-entries (multipart) ──→ [NestJS MemoryController]
                                                   └── MemoryEntryService
                                                         ├──→ [FastAPI POST /tag]
                                                         ├──→ [FastAPI POST /mask]
                                                         └──→ PostgreSQL (TypeORM)

[React 보호자 화면]
  └─── POST /memory-entries/:id/scenario ──→ [NestJS MemoryController]
                                                   └── MemoryEntryService
                                                         ├──→ decrypt(maskedContext)
                                                         ├──→ [FastAPI POST /scenario]
                                                         └──→ encrypt → PostgreSQL
```

### 4-2. 공개 인터페이스 명세

#### 백엔드 핵심 타입

```typescript
// backend/src/memory/types/memory-entry.types.ts [NEW]

export type EmotionTag = 'happy' | 'calm' | 'nostalgic' | 'excited';

export interface AiTagResult {
  locationTag: string;
  objectTags: string[];
}

export interface AiMaskResult {
  maskedText: string;
  // entity_map은 이 인터페이스에 포함하지 않음 (외부 누설 방지 원칙)
}

export interface ScenarioCacheData {
  openingQuestion: string;
}
```

```typescript
// backend/src/memory/dto/memory-entry-response.dto.ts [NEW]

export class MemoryEntryResponseDto {
  id: string;
  patientId: string;
  photoUrl: string | null;
  locationTag: string | null;
  objectTags: string[] | null;
  emotionTag: EmotionTag | null;
  targetWords: string[];
  hasScenario: boolean;         // scenarioCache !== null
  hasMaskedContext: boolean;    // maskedContext !== null
  createdAt: string;            // toISOString()
}
```

```typescript
// backend/src/memory/interfaces/IFastApiClient.ts [NEW]

export interface IFastApiClient {
  tag(imageUrl: string): Promise<AiTagResult>;
  mask(context: string): Promise<AiMaskResult>;
  generateScenario(
    maskedContext: string,
    targetWords: string[],
    hintLevel: 0 | 1 | 2,
  ): Promise<ScenarioCacheData>;
}
```

```typescript
// backend/src/memory/interfaces/ICryptoService.ts [NEW]

export interface ICryptoService {
  encrypt(plainText: string): string;
  decrypt(cipherText: string): string;
}
```

#### 프론트엔드 핵심 타입

```typescript
// frontend/src/memory-link/caregiver/domain/MemoryEntry.ts [NEW]

export type EmotionTag = 'happy' | 'calm' | 'nostalgic' | 'excited';

export interface MemoryEntry {
  id: string;
  patientId: string;
  photoUrl: string | null;
  locationTag: string | null;
  objectTags: string[] | null;
  emotionTag: EmotionTag | null;
  targetWords: string[];
  hasScenario: boolean;
  hasMaskedContext: boolean;
  createdAt: string;
}

export interface CreateMemoryEntryRequest {
  patientId: string;
  emotionTag?: EmotionTag;
  targetWords?: string[];
  photo: File;
}
```

```typescript
// frontend/src/memory-link/caregiver/infrastructure/MemoryEntryApi.ts [NEW]

export interface IMemoryEntryApi {
  create(data: CreateMemoryEntryRequest): Promise<MemoryEntry>;
  getAll(): Promise<MemoryEntry[]>;
  getById(id: string): Promise<MemoryEntry>;
  update(id: string, data: UpdateMemoryEntryRequest): Promise<MemoryEntry>;
  triggerScenario(id: string): Promise<{ status: string; memoryEntryId: string }>;
}
```

### 4-3. 에러 처리 전략

#### 도메인 에러 계층

```
MemoryEntryError (기반 클래스)
  - code: MemoryEntryErrorCode (열거형)
  - message: string

MemoryEntryErrorCode
  - NOT_FOUND             → NestJS NotFoundException (404)
  - FORBIDDEN             → NestJS ForbiddenException (403)
  - INVALID_EMOTION_TAG   → NestJS BadRequestException (400)
  - TARGET_WORDS_LIMIT    → NestJS BadRequestException (400)
  - PHOTO_REQUIRED        → NestJS BadRequestException (400)
  - INVALID_FILE_TYPE     → NestJS BadRequestException (400)
  - FILE_SIZE_EXCEEDED    → NestJS BadRequestException (400)
  - MASKING_NOT_COMPLETE  → NestJS UnprocessableEntityException (422)
  - TARGET_WORDS_REQUIRED → NestJS UnprocessableEntityException (422)
  - AI_SERVICE_UNAVAILABLE → NestJS BadGatewayException (502)
```

#### 레이어별 에러 처리 원칙

```
도메인 레이어   : MemoryEntryError(code, message) 생성 및 throw
애플리케이션 레이어: MemoryEntryError를 받아 NestJS 예외로 변환하는 ExceptionMapper 사용
                   또는 서비스 내에서 직접 NestJS 예외 throw
인프라 레이어   : 외부 API 실패 → MemoryEntryError(AI_SERVICE_UNAVAILABLE) throw
                  TypeORM 에러 → NestJS InternalServerErrorException
프레젠테이션 레이어(컨트롤러): NestJS 예외 필터가 HTTP 응답으로 변환 (별도 처리 불필요)
프레젠테이션 레이어(React) : Axios 에러를 extractErrorMessage()로 변환 후 UI 상태에 저장
```

---

## Phase 5: 테스트 전략

### 5-1. 단위 테스트 (Unit Test)

#### 도메인 - EmotionTag 유효성 검증

```
Given: 'happy'가 입력될 때
When:  isValidEmotionTag('happy')를 호출하면
Then:  true를 반환해야 한다

Given: 'angry'가 입력될 때
When:  isValidEmotionTag('angry')를 호출하면
Then:  false를 반환해야 한다
```

#### 서비스 - CreateMemoryEntry 정상 흐름

```
Given: 보호자 ID와 연결된 patientId가 일치하고, 5MB 이하 JPEG 파일이 제공될 때
When:  memoryEntryService.create()를 호출하면
Then:  DB에 저장되고, FastApiClientService.tag()와 .mask()가 각 1회 호출되며
       MemoryEntryResponseDto가 반환되어야 한다

Mock: Repository<MemoryEntry> → save(), update() stub
Mock: FastApiClientService → tag(), mask() mock
Mock: CryptoService → encrypt() stub (입력값 반환)
```

#### 서비스 - FastAPI 태깅 실패 시 부분 성공 허용

```
Given: FastApiClientService.tag()가 에러를 throw할 때
When:  memoryEntryService.create()를 호출하면
Then:  엔트리가 DB에 저장되고 (locationTag=null, objectTags=null),
       MemoryEntryResponseDto.hasMaskedContext가 false인 상태로 반환되어야 한다
```

#### 서비스 - TriggerScenario 사전 조건 실패

```
Given: maskedContext가 null인 엔트리가 조회될 때
When:  memoryEntryService.triggerScenario()를 호출하면
Then:  MemoryEntryError(MASKING_NOT_COMPLETE)이 throw되어야 한다
```

#### 서비스 - 소유권 검증 실패

```
Given: 요청한 caregiverId와 엔트리의 caregiverId가 다를 때
When:  memoryEntryService.findOne()을 호출하면
Then:  MemoryEntryError(FORBIDDEN)이 throw되어야 한다
```

#### CryptoService 단위 테스트

```
Given: "홍길동이 공원에 갔습니다" 라는 plainText가 있을 때
When:  encrypt() 후 decrypt()를 연속 호출하면
Then:  원본 문자열과 동일한 값이 반환되어야 한다

Given: 동일한 plainText로 encrypt()를 2회 호출할 때
When:  두 암호문을 비교하면
Then:  IV가 다르므로 암호문이 서로 달라야 한다 (재생 공격 방지)
```

#### useCaptureFlow 훅 단위 테스트 (Vitest)

```
Given: useCaptureFlow('patient-uuid')가 초기화될 때
When:  step을 확인하면
Then:  'photo' 상태여야 한다

Given: setPhoto()로 파일을 설정한 뒤
When:  step을 확인하면
Then:  'emotion' 상태로 자동 전이되어야 한다

Given: targetWords가 이미 3개인 상태에서
When:  addTargetWord()를 호출하면
Then:  targetWords가 3개를 초과하지 않아야 한다

Given: submit()이 성공적으로 완료되면
When:  step을 확인하면
Then:  'done' 상태여야 한다
```

### 5-2. 통합 테스트 (Integration Test)

#### MemoryController E2E (NestJS Testing Module)

```
Given: JWT 토큰이 포함된 요청으로
When:  POST /memory-entries에 multipart 요청을 보내면
Then:  201 Created와 MemoryEntryResponseDto 형태의 응답을 받아야 한다

Given: 타인의 엔트리 ID로
When:  GET /memory-entries/:id를 호출하면
Then:  403 Forbidden 응답을 받아야 한다

Given: maskedContext가 없는 엔트리 ID로
When:  POST /memory-entries/:id/scenario를 호출하면
Then:  422 Unprocessable Entity 응답을 받아야 한다
```

### 5-3. E2E 테스트 (Vitest + React Testing Library)

```
Given: 보호자가 로그인하여 CaregiverDashboard에 접근했을 때
When:  "새 기억 추가" 버튼을 클릭하면
Then:  CaptureScreen의 사진 선택 단계가 표시되어야 한다

Given: CaptureScreen에서 사진, 감정태그, 목표단어를 모두 입력하고 제출할 때
When:  API 호출이 성공하면
Then:  EntryListScreen으로 이동하고 새 항목이 목록에 표시되어야 한다

Given: 엔트리 상세화면에서
When:  "시나리오 생성" 버튼을 클릭하면
Then:  버튼이 로딩 상태가 되고, 성공 후 hasScenario가 true로 업데이트되어야 한다
```

### 5-4. 테스트 더블 전략

| 대상 | 테스트 더블 종류 | 이유 |
|------|----------------|------|
| FastApiClientService | Mock | 외부 FastAPI 의존성 제거, 호출 횟수 검증 필요 |
| CryptoService | Stub | 고정된 암/복호화 결과 반환 (순수성 검증에 불필요한 복잡성 제거) |
| Repository<MemoryEntry> | Stub | 고정된 DB 응답 반환 |
| PostgreSQL (통합 테스트) | Fake (In-Memory SQLite) | 실제 DB 스키마 구조 검증 |
| memoryEntryApi (React 훅 테스트) | Mock | HTTP 호출 격리 |

---

## Phase 6: 위험 요소 및 기술 부채 분석

### 6-1. 기술적 위험 요소

| 위험 요소 | 발생 가능성 | 영향도 | 대응 방안 |
|-----------|:---------:|:------:|-----------|
| AES 키 관리 미흡 | 보통 | 높음 | .env에 CRYPTO_SECRET_KEY 필수 설정, 키 없으면 서버 시작 차단 (ConfigService 검증 로직) |
| Multer 메모리 저장 시 OOM | 낮음 | 높음 | diskStorage 사용, tts-cache/memory-images/ 경로에 직접 저장 |
| FastAPI 응답 지연 (5~10초) | 높음 | 보통 | 업로드 응답 즉시 반환 + 태깅/마스킹은 Promise.allSettled 병렬 처리, UI에 "AI 분석 중" 상태 표시 |
| entity_map PII 누설 | 낮음 | 높음 | FastApiClientService.mask()에서 응답 수신 즉시 entity_map 필드 미사용/폐기, 로깅 금지 |
| 이미지 URL 직접 노출 | 보통 | 보통 | 정적 파일 서빙 시 JwtAuthGuard 적용 or 서명된 URL 방식 (Phase 2) |
| targetWords 수정 시 scenarioCache 불일치 | 높음 | 보통 | Update 유스케이스에서 targetWords 변경 감지 시 scenarioCache 자동 null 초기화 |
| NestJS @nestjs/axios 미설치 가능성 | 보통 | 높음 | package.json 확인 후 설치 필요 (`npm install @nestjs/axios axios`) |

### 6-2. SOLID 원칙 준수 점검

- **S (단일 책임)**
  - MemoryEntryService: 비즈니스 흐름 조율만 담당. 암호화 로직은 CryptoService 위임. AI 호출은 FastApiClientService 위임. (준수)
  - MemoryController: HTTP 요청 파싱 및 응답 반환만 담당. 비즈니스 로직 없음. (준수)
  - CryptoService: 암복호화만 담당. (준수)

- **O (개방-폐쇄)**
  - 새 emotionTag 값 추가 시 constants 파일만 수정 (준수)
  - 저장소 교체 시 ICryptoService, IFastApiClient, IMemoryEntryRepository 구현체만 교체 (준수)

- **L (리스코프 치환)**
  - IFastApiClient 구현체(FastApiClientService)를 MockFastApiClient로 교체해도 상위 서비스 동작 변경 없음 (준수)
  - ICryptoService 구현체를 PgCryptoCryptoService로 교체해도 동일하게 동작 (준수)

- **I (인터페이스 분리)**
  - IFastApiClient: tag/mask/generateScenario 3개 메서드 (시나리오가 없는 컨텍스트에서 불필요한 메서드 호출 없음)
  - ICryptoService: encrypt/decrypt 2개 메서드만 (최소화, 준수)

- **D (의존성 역전)**
  - MemoryEntryService가 FastApiClientService 구현체를 직접 import하지 않고 IFastApiClient 인터페이스에 의존 (권장 구조)
  - NestJS DI 컨테이너로 구현체를 주입 (준수)
  - 주의: 현재 설계에서 TypeORM Repository는 인터페이스 없이 직접 주입됨 → MVP에서는 허용, 추후 IMemoryEntryRepository로 추상화 권장

### 6-3. 확장성 시나리오 검토

- **사진 저장소를 로컬 → Azure Blob으로 교체한다면?**
  FileStorageService의 getPublicUrl() 구현만 교체. MemoryEntry.photoUrl은 URL 문자열이므로 컨트롤러/서비스 변경 없음.

- **암호화 방식을 Node.js crypto → pgcrypto로 교체한다면?**
  ICryptoService를 구현하는 PgCryptoCryptoService를 작성하고 NestJS DI 제공자 교체만 필요. 서비스 로직 변경 없음.

- **감정태그 종류를 추가한다면?**
  `memory-entry.constants.ts`의 VALID_EMOTION_TAGS 배열과 EmotionTag 타입에 추가. 프론트엔드 EMOTION_TAG_LABELS에도 추가. 기존 로직 수정 없음.

- **시나리오 생성을 동기 → 비동기 큐 방식으로 전환한다면?**
  TriggerScenario 유스케이스에서 FastAPI 직접 호출 부분만 BullMQ 작업 큐 발행으로 교체. 컨트롤러 응답 형식(status: 'triggered') 변경 없음.

- **목표 단어를 3개에서 5개로 늘린다면?**
  `MAX_TARGET_WORDS` 상수 변경 1곳. DTO 유효성 검증 자동 반영.

---

## Phase 7: 산출물

### 7-1. 파일 구조 (신규/수정/삭제 명시)

```
backend/
├── src/
│   ├── main.ts                                      [MODIFY] useStaticAssets('/uploads/memory-images') 설정 추가 [결정-1]
│   ├── app.module.ts                                [MODIFY] MemoryModule import 추가
│   └── memory/
    ├── constants/
    │   └── memory-entry.constants.ts               [NEW]  MAX_TARGET_WORDS, ALLOWED_MIME_TYPES 등
    ├── dto/
    │   ├── create-memory-entry.dto.ts              [MODIFY] 기존 파일, Multer 주석 보완
    │   ├── update-memory-entry.dto.ts              [MODIFY] 기존 파일, 그대로 유지
    │   ├── memory-entry-response.dto.ts            [NEW]   응답 DTO (hasScenario, hasMaskedContext)
    │   └── trigger-scenario-response.dto.ts        [NEW]   시나리오 트리거 응답 DTO
    ├── entities/
    │   └── memory-entry.entity.ts                  [MODIFY] 기존 파일, 변경 불필요 (이미 완성)
    ├── errors/
    │   └── memory-entry.errors.ts                  [NEW]   MemoryEntryErrorCode 열거형, MemoryEntryError 클래스
    ├── interfaces/
    │   ├── IFastApiClient.ts                       [NEW]   FastAPI 클라이언트 인터페이스
    │   ├── ICryptoService.ts                       [NEW]   암호화 서비스 인터페이스
    │   └── IMemoryEntryService.ts                  [NEW]   서비스 인터페이스
    ├── services/
    │   ├── fast-api-client.service.ts              [NEW]   IFastApiClient 구현체 (@nestjs/axios)
    │   ├── crypto.service.ts                       [NEW]   ICryptoService 구현체 (Node.js crypto, AES-256-CBC)
    │   └── file-storage.service.ts                 [NEW]   파일 URL 경로 관리 서비스
    ├── types/
    │   └── memory-entry.types.ts                   [NEW]   AiTagResult, AiMaskResult, ScenarioCacheData
    ├── memory.controller.ts                        [NEW]   MemoryController (@UseGuards JwtAuthGuard)
    ├── memory.service.ts                           [NEW]   MemoryEntryService 구현
    └── memory.module.ts                            [NEW]   MemoryModule 등록

frontend/src/memory-link/
├── caregiver/
│   ├── domain/
│   │   └── MemoryEntry.ts                         [NEW]   MemoryEntry 타입, EmotionTag, CreateMemoryEntryRequest
│   ├── application/
│   │   ├── useMemoryEntries.ts                    [NEW]   목록 조회 + 시나리오 트리거 훅
│   │   └── useCaptureFlow.ts                      [NEW]   3단계 캡처 플로우 상태 관리 훅
│   ├── infrastructure/
│   │   └── MemoryEntryApi.ts                      [NEW]   IMemoryEntryApi 인터페이스 + 구현체
│   └── presentation/
│       ├── CaregiverDashboard.tsx                 [MODIFY] 플레이스홀더 → 실제 대시보드 교체
│       ├── CaptureScreen.tsx                      [NEW]   사진+감정태그+목표단어 3단계 UI
│       ├── EntryListScreen.tsx                    [NEW]   메모리 엔트리 목록 카드 UI
│       └── EntryDetailScreen.tsx                  [NEW]   엔트리 상세 + 시나리오 트리거 버튼
└── shared/
    ├── AuthContext.tsx                             [변경 없음]
    └── MemoryLinkApi.ts                            [변경 없음]
```

### 7-2. 구현 체크리스트

```
## 메모리 엔트리 (Memory Entry) 구현 체크리스트

### 준비 작업
- [ ] [쉬움] backend/package.json에서 @nestjs/axios 포함 여부 확인 후 미포함 시 설치: `cd backend && npm install @nestjs/axios axios` [결정-4]
- [ ] [쉬움] .env 파일에 FASTAPI_URL, CRYPTO_SECRET_KEY(32자 이상), UPLOAD_DIR 환경변수 추가
- [ ] [쉬움] main.ts에 정적 파일 서빙 설정 추가: `app.useStaticAssets('tts-cache/memory-images', { prefix: '/uploads/memory-images' })` [결정-1]

### Domain Layer (백엔드)
- [ ] [쉬움] constants/memory-entry.constants.ts 생성
  - [ ] MAX_TARGET_WORDS = 3
  - [ ] MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024
  - [ ] ALLOWED_MIME_TYPES 배열
  - [ ] VALID_EMOTION_TAGS 배열
- [ ] [쉬움] errors/memory-entry.errors.ts 생성
  - [ ] MemoryEntryErrorCode 열거형 (9개 코드)
  - [ ] MemoryEntryError 클래스 (code, message)
- [ ] [쉬움] types/memory-entry.types.ts 생성
  - [ ] AiTagResult 인터페이스
  - [ ] AiMaskResult 인터페이스 (entity_map 미포함)
  - [ ] ScenarioCacheData 인터페이스
- [ ] [쉬움] interfaces/IFastApiClient.ts 생성
- [ ] [쉬움] interfaces/ICryptoService.ts 생성
- [ ] [쉬움] interfaces/IMemoryEntryService.ts 생성

### Application Layer (백엔드)
- [ ] [쉬움] dto/memory-entry-response.dto.ts 생성
  - [ ] MemoryEntryResponseDto 필드 정의 (maskedContext, scenarioCache 미포함)
  - [ ] toDto() 변환 함수 작성
- [ ] [쉬움] dto/trigger-scenario-response.dto.ts 생성
- [ ] [어려움] memory.service.ts 구현 (MemoryEntryService)
  - [ ] create(): 소유권 검증 → DB 저장 → AI 태깅 → 마스킹 (부분 성공 허용)
  - [ ] findAll(): caregiverId로 필터링, isActive=true
  - [ ] findOne(): 소유권 검증, 404/403 에러 처리
  - [ ] update(): 소유권 검증, targetWords 변경 시 scenarioCache null 초기화
  - [ ] triggerScenario(): maskedContext 복호화 → FastAPI /scenario → 암호화 저장

### Infrastructure Layer (백엔드)
- [ ] [보통] services/crypto.service.ts 구현 (AES-256-CBC, IV 포함)
  - [ ] encrypt(): crypto.randomBytes(16) IV 생성, iv:base64(ciphertext) 반환
  - [ ] decrypt(): iv:ciphertext 형식 파싱, 복호화
  - [ ] CRYPTO_SECRET_KEY 미설정 시 서버 시작 차단
- [ ] [보통] services/fast-api-client.service.ts 구현
  - [ ] tag(): POST {FASTAPI_URL}/tag, imageUrl 전송
  - [ ] mask(): POST {FASTAPI_URL}/mask, context 전송, entity_map 수신 후 즉시 폐기
  - [ ] generateScenario(): POST {FASTAPI_URL}/scenario, 동기 호출 (timeout: 30000ms) [결정-2]
  - [ ] 실패 시 MemoryEntryError(AI_SERVICE_UNAVAILABLE) throw
- [ ] [쉬움] services/file-storage.service.ts 구현
  - [ ] 업로드 디렉토리 설정 및 공개 URL 생성
- [ ] [보통] memory.module.ts 생성
  - [ ] TypeOrmModule.forFeature([MemoryEntry]) 등록
  - [ ] HttpModule 등록
  - [ ] MulterModule.register() (diskStorage, tts-cache/memory-images/ 경로)
  - [ ] CryptoService, FastApiClientService, FileStorageService provider 등록
- [ ] [쉬움] app.module.ts 수정: MemoryModule import 추가

### Presentation Layer (백엔드)
- [ ] [보통] memory.controller.ts 구현
  - [ ] @UseGuards(JwtAuthGuard) 전체 적용
  - [ ] POST /memory-entries: FileInterceptor('photo') + ParseFilePipe 유효성 검증
  - [ ] GET /memory-entries: 목록 반환
  - [ ] GET /memory-entries/:id: ParseUUIDPipe 적용
  - [ ] PATCH /memory-entries/:id: UpdateMemoryEntryDto 적용
  - [ ] POST /memory-entries/:id/scenario: 시나리오 트리거
  - [ ] MemoryEntryError → NestJS 예외 변환 처리 (try/catch 또는 ExceptionFilter)

### Domain Layer (프론트엔드)
- [ ] [쉬움] caregiver/domain/MemoryEntry.ts 생성
  - [ ] EmotionTag 타입 및 EMOTION_TAG_LABELS 상수
  - [ ] MemoryEntry 인터페이스
  - [ ] CreateMemoryEntryRequest, UpdateMemoryEntryRequest 인터페이스

### Infrastructure Layer (프론트엔드)
- [ ] [보통] caregiver/infrastructure/MemoryEntryApi.ts 생성
  - [ ] IMemoryEntryApi 인터페이스 정의
  - [ ] create(): FormData 구성 (photo, patientId, emotionTag, targetWords[])
  - [ ] getAll(): GET /memory-entries
  - [ ] getById(): GET /memory-entries/:id
  - [ ] update(): PATCH /memory-entries/:id
  - [ ] triggerScenario(): POST /memory-entries/:id/scenario
  - [ ] 런타임 타입 검증 (isMemoryEntry() 가드 함수)

### Application Layer (프론트엔드)
- [ ] [보통] caregiver/application/useCaptureFlow.ts 구현
  - [ ] step 상태 머신: photo → emotion → words → submitting → done
  - [ ] setPhoto(): File → photoPreview URL 생성
  - [ ] addTargetWord(): 3개 초과 시 무시
  - [ ] submit(): memoryEntryApi.create() 호출, 에러 처리
  - [ ] reset(): 초기 상태 복원
- [ ] [보통] caregiver/application/useMemoryEntries.ts 구현
  - [ ] 마운트 시 getAll() 자동 호출
  - [ ] triggerScenario(): scenarioStatus 상태 업데이트 (idle→pending→done/error)
  - [ ] refresh(): 목록 재조회

### Presentation Layer (프론트엔드)
- [ ] [보통] caregiver/presentation/CaptureScreen.tsx 구현
  - [ ] 1단계 - 사진 선택: 파일 input + 미리보기
  - [ ] 2단계 - 감정 태그: 4개 chip 버튼 UI (happy/calm/nostalgic/excited)
  - [ ] 3단계 - 목표 단어: 텍스트 입력 + chip 목록 (최대 3개 표시)
  - [ ] 제출 중 로딩 상태 및 에러 메시지 표시
- [ ] [쉬움] caregiver/presentation/EntryListScreen.tsx 구현
  - [ ] 엔트리 카드: 썸네일 + 감정태그 + 목표단어 미리보기
  - [ ] hasScenario 여부 배지 표시
  - [ ] "새 기억 추가" 버튼
- [ ] [보통] caregiver/presentation/EntryDetailScreen.tsx 구현
  - [ ] 상세 정보 표시 (locationTag, objectTags, emotionTag, targetWords)
  - [ ] "시나리오 생성" 버튼 (hasMaskedContext=false일 때 비활성화)
  - [ ] 시나리오 생성 완료 상태 표시 (hasScenario=true)
- [ ] [보통] caregiver/presentation/CaregiverDashboard.tsx 수정
  - [ ] 플레이스홀더 제거
  - [ ] EntryListScreen + CaptureScreen 진입점 구성

### Tests (백엔드 - Jest)
- [ ] [쉬움] CryptoService 단위 테스트
  - [ ] encrypt → decrypt 왕복 검증
  - [ ] 동일 입력에 대한 암호문 비결정성 검증 (IV 랜덤성)
- [ ] [보통] MemoryEntryService 단위 테스트
  - [ ] create() 정상 흐름 (FastApiClientService mock)
  - [ ] create() FastAPI 태깅 실패 시 부분 성공 허용
  - [ ] triggerScenario() maskedContext 없을 때 MASKING_NOT_COMPLETE 에러
  - [ ] findOne() 소유권 불일치 시 FORBIDDEN 에러
- [ ] [보통] FastApiClientService 단위 테스트
  - [ ] tag() 정상 응답 파싱
  - [ ] mask() entity_map 미포함 응답 반환 검증
  - [ ] 외부 API 실패 시 AI_SERVICE_UNAVAILABLE 에러

### Tests (프론트엔드 - Vitest)
- [ ] [보통] useCaptureFlow 훅 단위 테스트
  - [ ] 초기 상태 검증 (step='photo')
  - [ ] step 전이 흐름 검증
  - [ ] targetWords 3개 제한 검증
  - [ ] submit() 성공/실패 시나리오
- [ ] [보통] useMemoryEntries 훅 단위 테스트
  - [ ] 마운트 시 getAll() 호출 검증
  - [ ] triggerScenario() 상태 전이 검증 (idle→pending→done)
- [ ] [보통] CaptureScreen 컴포넌트 테스트
  - [ ] 3단계 렌더링 전이 검증
  - [ ] 목표 단어 3개 초과 입력 방지 검증
```

---

## 확정된 결정 사항 (2026-03-22 승인)

모든 미결 결정 사항이 아래와 같이 확정되었습니다. 구현 시 이 결정을 따른다.

### [결정-1] 이미지 공개 URL 접근 방식: UUID 랜덤 파일명 기반 인증 없는 정적 서빙 (옵션 A 채택)

**확정 내용**:
- Multer diskStorage에서 저장 시 파일명을 `uuid()` 생성 값으로 교체 (원본 파일명 미사용)
- NestJS `main.ts`에서 `app.useStaticAssets('tts-cache/memory-images', { prefix: '/uploads/memory-images' })` 설정
- photoUrl 형식: `/uploads/memory-images/<uuid>.<ext>` (예: `/uploads/memory-images/a3f1c2d4-....jpg`)
- 인증 없이 URL만 알면 접근 가능하나, UUID 랜덤성으로 URL 유추 불가 처리로 MVP 보안 수준 충족
- Phase 2에서 Azure Blob SAS URL 방식으로 교체 가능 (FileStorageService.getPublicUrl() 교체만 필요)

**구현 영향**:
- `FileStorageService`: `saveFile()` 메서드에서 `uuid() + extname(originalname)` 으로 파일명 결정
- `memory.module.ts`: MulterModule.register()에 `filename` 콜백에서 uuid 적용
- `main.ts`: `ServeStaticModule` 또는 `useStaticAssets` 설정 추가 [MODIFY]

### [결정-2] 시나리오 생성 호출 방식: 30초 타임아웃 동기 호출 (옵션 A 채택)

**확정 내용**:
- `POST /memory-entries/:id/scenario` 는 FastAPI `/scenario` 응답을 기다리는 동기 호출로 구현
- FastAPI 클라이언트(`FastApiClientService.generateScenario()`)에 **30초 타임아웃** 설정
  - `@nestjs/axios`의 `HttpService`에서 `{ timeout: 30000 }` 옵션 전달
- 30초 내 응답 없으면 `AI_SERVICE_UNAVAILABLE` 에러(502) 반환
- Phase 2에서 BullMQ 비동기 큐로 전환 시 `TriggerScenario` 유스케이스의 FastAPI 호출 부분만 교체

**구현 영향**:
- `fast-api-client.service.ts`: `generateScenario()` 내 `this.httpService.post(url, body, { timeout: 30000 })`

### [결정-3] 사진 수정 불가 정책 확정 (새 엔트리 생성 유도)

**확정 내용**:
- `UpdateMemoryEntryDto`에서 `photo` 관련 필드를 명시적으로 제외
- 수정 가능 필드: `emotionTag`, `targetWords` 만 허용
- 사진 변경이 필요한 경우 기존 엔트리를 소프트 삭제 후 새 엔트리 생성 유도
- `PATCH /memory-entries/:id` 요청에 photo 파일이 포함되어도 서버에서 무시 (FileInterceptor 미적용)

**구현 영향**:
- `update-memory-entry.dto.ts` [MODIFY]: `emotionTag?`, `targetWords?` 필드만 유지, photo 필드 명시적 미포함
- `memory.controller.ts`: `@Patch(':id')` 핸들러에 `@UseInterceptors(FileInterceptor)` 미적용

### [결정-4] @nestjs/axios 설치 확인 후 추가

**확정 내용**:
- 구현 시작 전 `backend/package.json` 에서 `@nestjs/axios` 포함 여부 확인
- 미포함 시 즉시 설치: `cd backend && npm install @nestjs/axios axios`
- 구현 체크리스트 첫 번째 항목으로 배치 (이미 반영됨)

**구현 영향**:
- `memory.module.ts`: `HttpModule` import (`@nestjs/axios`)
- `fast-api-client.service.ts`: `HttpService` 주입 (`@nestjs/axios`)
