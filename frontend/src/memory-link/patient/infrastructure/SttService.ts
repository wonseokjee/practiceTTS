import type { SttResult } from '../domain/TrainingSession.js';

/**
 * STT(Speech-to-Text) 서비스 인터페이스
 * - Web Speech API(SpeechRecognition) 래퍼
 * - 한국어(ko-KR) 설정
 * - confidence < 0.6 이면 재시도 유도 (onError 콜백으로 처리)
 */
export interface ISttService {
  /**
   * STT 인식 시작.
   * @param candidates 정답 후보(phrase hint). 서버 STT가 제약 인식에 활용한다.
   *                   Web Speech 구현은 무시한다(브라우저 API 제약).
   */
  start(candidates?: string[]): void;
  /** STT 인식 중단 */
  stop(): void;
  /** 인식 성공 시 콜백 (신뢰도 기준 충족 시에만 호출) */
  onResult: ((result: SttResult) => void) | null;
  /** 인식 에러 또는 신뢰도 미달 시 콜백 */
  onError: ((error: string) => void) | null;
}

/** window.SpeechRecognition 또는 webkitSpeechRecognition 타입 */
type SpeechRecognitionConstructor = new () => SpeechRecognition;

/** 최소 STT 신뢰도 임계값 */
const MIN_CONFIDENCE = 0.6;

/**
 * Web Speech API 기반 STT 서비스 구현체
 * - 한국어(ko-KR) 전용
 * - 단일 인식 모드 (continuous=false, interimResults=false)
 * - confidence < MIN_CONFIDENCE: onError로 재시도 안내
 * - SpeechRecognition API 미지원 브라우저: onError로 안내
 */
export class WebSpeechSttService implements ISttService {
  onResult: ((result: SttResult) => void) | null = null;
  onError: ((error: string) => void) | null = null;

  private recognition: SpeechRecognition | null = null;
  private isRunning = false;

  constructor() {
    const SpeechRecognitionClass = this.getSpeechRecognitionClass();
    if (SpeechRecognitionClass !== null) {
      this.recognition = new SpeechRecognitionClass();
      this.setupRecognition(this.recognition);
    }
  }

  start(candidates?: string[]): void {
    // Web Speech API는 phrase hint를 지원하지 않으므로 candidates는 무시한다.
    void candidates;
    if (this.recognition === null) {
      this.onError?.('이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 사용을 권장합니다.');
      return;
    }

    if (this.isRunning) {
      return;
    }

    try {
      this.isRunning = true;
      this.recognition.start();
    } catch {
      this.isRunning = false;
      this.onError?.('음성 인식을 시작할 수 없습니다. 마이크 권한을 확인해주세요.');
    }
  }

  stop(): void {
    if (this.recognition !== null && this.isRunning) {
      this.recognition.stop();
      this.isRunning = false;
    }
  }

  private setupRecognition(recognition: SpeechRecognition): void {
    recognition.lang = 'ko-KR';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      this.isRunning = false;
      const result = event.results[0]?.[0];
      if (result === undefined) {
        this.onError?.('음성을 인식하지 못했습니다. 다시 말씀해주세요.');
        return;
      }

      const { transcript, confidence } = result;

      // 신뢰도 기준 미달 시 재시도 안내
      if (confidence < MIN_CONFIDENCE) {
        this.onError?.(
          `음성이 명확하지 않습니다 (인식률: ${Math.round(confidence * 100)}%). 다시 말씀해주세요.`,
        );
        return;
      }

      this.onResult?.({ transcript, confidence });
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.isRunning = false;

      // 사용자가 직접 중단한 경우는 에러로 처리하지 않음
      if (event.error === 'aborted') {
        return;
      }

      const errorMessages: Record<string, string> = {
        'no-speech': '음성이 감지되지 않았습니다. 마이크에 가까이 말씀해주세요.',
        'audio-capture': '마이크를 찾을 수 없습니다. 마이크 연결을 확인해주세요.',
        'not-allowed': '마이크 접근이 거부되었습니다. 브라우저 설정에서 허용해주세요.',
        'network': '네트워크 오류가 발생했습니다. 연결을 확인해주세요.',
        'service-not-allowed': '음성 인식 서비스를 사용할 수 없습니다.',
      };

      const message = errorMessages[event.error] ?? `음성 인식 오류: ${event.error}`;
      this.onError?.(message);
    };

    recognition.onend = () => {
      this.isRunning = false;
    };
  }

  private getSpeechRecognitionClass(): SpeechRecognitionConstructor | null {
    const win = window as unknown as Record<string, unknown>;
    if (typeof win['SpeechRecognition'] === 'function') {
      return win['SpeechRecognition'] as SpeechRecognitionConstructor;
    }
    if (typeof win['webkitSpeechRecognition'] === 'function') {
      return win['webkitSpeechRecognition'] as SpeechRecognitionConstructor;
    }
    return null;
  }
}
