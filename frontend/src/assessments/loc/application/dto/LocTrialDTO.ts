import type { LocScoreLabel } from '../../domain/LocScorer.js';
/**
 * LOC 검사 DTO (Data Transfer Object)
 *
 * 애플리케이션 계층과 프레젠테이션 계층 간 데이터 전달용.
 * 도메인 엔티티/값 객체를 직접 노출하지 않기 위해 사용한다.
 */

export interface LocTrialRequestDTO {
  trialNumber: 1 | 2 | 3;
  /** TTS 종료 시각 (performance.now() 기준, ms) */
  audioEndTime: number;
  /** 터치 시각 (performance.now() 기준, ms). 무응답 시 null */
  touchTime: number | null;
  /** 터치 X 좌표 (viewport 기준, px) */
  touchX: number;
  /** 터치 Y 좌표 (viewport 기준, px) */
  touchY: number;
  /** 터치 버튼의 경계 영역 */
  buttonBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface LocTrialResponseDTO {
  trialNumber: number;
  /** 반응 지연 시간 (ms). 무응답 시 null */
  latencyMs: number | null;
  touchInBounds: boolean;
  score: 0 | 1 | 2 | 3;
  /**
   * 사람이 읽는 결과 라벨.
   *
   * 0점은 '무반응'(반응 없음)과 '영역 외 터치'(반응했으나 버튼 밖)를 뭉치므로
   * 라벨은 둘을 구분한다. 원자료로 구분하려면 latencyMs(무반응이면 null)와
   * touchInBounds를 보면 된다.
   */
  scoreLabel: LocScoreLabel;
  /** 3회 시도가 모두 완료되었는지 여부 */
  isComplete: boolean;
}

export interface LocAssessmentResultDTO {
  id: string;
  finalScore: number;
  trials: LocTrialResponseDTO[];
  totalDurationMs: number;
}
