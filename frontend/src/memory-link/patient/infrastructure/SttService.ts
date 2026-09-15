import type { SttResult } from '../domain/TrainingSession.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import { i18n } from '../../../shared/i18n/i18n.js';

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
  /** 취소 — 결과를 만들지 않고 인식/녹음을 중단한다(이탈 시 서버 업로드 방지). */
  cancel(): void;
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
      this.onError?.(i18n.t('sttError.notSupported', { ns: 'patient' }));
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
      this.onError?.(i18n.t('sttError.startFailed', { ns: 'patient' }));
    }
  }

  stop(): void {
    if (this.recognition !== null && this.isRunning) {
      this.recognition.stop();
      this.isRunning = false;
    }
  }

  cancel(): void {
    // 브라우저 인식은 서버 업로드가 없다. abort로 결과 없이 즉시 중단한다.
    if (this.recognition !== null && this.isRunning) {
      this.recognition.abort();
      this.isRunning = false;
    }
  }

  private setupRecognition(recognition: SpeechRecognition): void {
    recognition.lang = DEFAULT_LOCALE;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      this.isRunning = false;
      const result = event.results[0]?.[0];
      if (result === undefined) {
        this.onError?.(i18n.t('sttError.noResult', { ns: 'patient' }));
        return;
      }

      const { transcript, confidence } = result;

      // 신뢰도 기준 미달 시 재시도 안내
      if (confidence < MIN_CONFIDENCE) {
        this.onError?.(
          i18n.t('sttError.lowConfidence', {
            ns: 'patient',
            percent: Math.round(confidence * 100),
          }),
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
        'no-speech': i18n.t('sttError.noSpeech', { ns: 'patient' }),
        'audio-capture': i18n.t('sttError.audioCapture', { ns: 'patient' }),
        'not-allowed': i18n.t('sttError.notAllowed', { ns: 'patient' }),
        'network': i18n.t('sttError.network', { ns: 'patient' }),
        'service-not-allowed': i18n.t('sttError.serviceNotAllowed', { ns: 'patient' }),
      };

      const message =
        errorMessages[event.error] ??
        i18n.t('sttError.unknown', { ns: 'patient', error: event.error });
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
