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
  scoreLabel: '정상' | '경도 지연' | '중도 지연' | '무반응';
  /** 3회 시도가 모두 완료되었는지 여부 */
  isComplete: boolean;
}

export interface LocAssessmentResultDTO {
  id: string;
  finalScore: number;
  trials: LocTrialResponseDTO[];
  totalDurationMs: number;
}
