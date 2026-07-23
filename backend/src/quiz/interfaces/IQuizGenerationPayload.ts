import { PatientNoteCategory } from '../constants/patient-note-category';
import { GeneratableQuizType } from '../constants/quiz-question-type';

/**
 * Phase 3 QuizGenerationClient가 FastAPI(`/quiz/generate`)에 전달할 페이로드의 **화이트리스트**.
 *
 * 본 인터페이스에 정의된 필드 외에는 LLM 호출 페이로드에 일체 포함하지 않는다.
 *
 * 본 인터페이스는 Phase 1에서 미리 정의하여, Phase 3 코드 작성 시
 * TypeScript 컴파일러가 보호자 사적 데이터(`mood`, `caregiverReflection`,
 * `caregiverWishMessage`)의 진입을 **타입 단계에서 차단**한다.
 *
 * 본 인터페이스에 다음 필드는 **영원히 추가하지 않는다** (코드 리뷰 시 강제):
 *   - mood / moodLevel
 *   - caregiverReflection / caregiverAnswer
 *   - caregiverWishMessage
 *   - 그 외 보호자 사적 데이터 일체
 */
export interface IQuizGenerationPayload {
  /**
   * 환자 답변 (PatientMemoryNote)의 화이트리스트 사본.
   * answerText는 PII 마스킹 정책 적용 후 전달 (Phase 2/3 결정).
   */
  patientNotes: ReadonlyArray<{
    category: PatientNoteCategory;
    answerText: string;
  }>;

  /**
   * 사진 태그 (Phase 2에서 R7=(b)로 전환 시 활성).
   * Phase 1에서는 미사용.
   */
  photoTags?: {
    location: string;
    objects: ReadonlyArray<string>;
  };

  /**
   * 훈련 목표 단어 (MemoryEntry.targetWords, 호환 유지 필드).
   */
  targetWords?: ReadonlyArray<string>;

  /**
   * 문제 유형별 분포 요청 (LLM이 생성 가능한 유형만).
   * tile_arrange/speech는 백엔드가 fill_blank를 변환해 만들므로 여기 포함하지 않는다.
   */
  distribution?: {
    [K in GeneratableQuizType]: number;
  };
}
