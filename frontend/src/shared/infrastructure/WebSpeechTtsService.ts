/**
 * Web Speech API 기반 TTS 서비스 구현체
 *
 * - 언어: ko-KR (가능한 경우), 없으면 시스템 기본 음성으로 폴백
 * - 속도(rate): 0.85 (실어증 환자를 위한 느린 속도)
 * - audioEndTime: utterance.onend 콜백 내부에서 performance.now()로 측정
 * - 재생 실패 시 Promise.reject()로 에러 전파
 *
 * Chrome 버그 대응:
 *   1. getVoices()는 최초 호출 시 빈 배열 반환 → voiceschanged 이벤트 대기
 *   2. 음성 미선택 시 onend 미발화 → 명시적 voice 지정
 *   3. interrupted 에러는 canceled와 동일하게 정상 중단으로 처리
 *   4. onend가 30초 내 발화하지 않으면 강제 resolve (안전 타임아웃)
 */

import type { ITtsService, TtsPlaybackResult } from '../domain/ITtsService.js';
import { DEFAULT_LOCALE, languageOf } from '../domain/locale.js';

const VOICE_LOAD_TIMEOUT_MS = 3_000;
const TTS_SAFETY_TIMEOUT_MS = 30_000;

/** Chrome voiceschanged 이벤트를 기다리며 음성 목록을 로드한다 */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      resolve(voices);
      return;
    }

    const timeoutId = setTimeout(() => {
      speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      resolve(speechSynthesis.getVoices());
    }, VOICE_LOAD_TIMEOUT_MS);

    function onVoicesChanged() {
      clearTimeout(timeoutId);
      speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      resolve(speechSynthesis.getVoices());
    }

    speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
  });
}

/**
 * 그 로케일의 음성을 고른다. 없으면 시스템 기본 음성을 쓴다.
 *
 * 순위는 예전 `selectKoreanVoice`와 **똑같다** — 로케일만 인자로 뺐다.
 * 브라우저가 주는 음성 목록은 지역까지 맞는 것이 없을 수도 있어(`ko`만 있는
 * 경우) 언어 코드로 한 번 더 찾는 단계가 필요하다.
 */
function selectVoiceForLocale(
  voices: SpeechSynthesisVoice[],
  locale: string,
): SpeechSynthesisVoice | null {
  // 1순위: 로케일이 정확히 맞는 로컬 음성
  const localExact = voices.find((v) => v.lang === locale && v.localService);
  if (localExact) return localExact;

  // 2순위: 로케일이 정확히 맞는 음성 (원격 포함)
  const anyExact = voices.find((v) => v.lang === locale);
  if (anyExact) return anyExact;

  // 3순위: 언어만 맞는 음성 (ko-KR 요청에 ko 음성만 있는 경우)
  const sameLanguage = voices.find((v) =>
    v.lang.startsWith(languageOf(locale)),
  );
  if (sameLanguage) return sameLanguage;

  // 4순위: 시스템 기본 음성
  const defaultVoice = voices.find((v) => v.default);
  return defaultVoice ?? (voices[0] ?? null);
}

export class WebSpeechTtsService implements ITtsService {
  private readonly rate = 0.85;
  /** 어느 언어로 읽을지. 기본값의 출처는 `shared/domain/locale` 하나다. */
  private readonly locale: string;
  private cachedVoice: SpeechSynthesisVoice | null = null;
  private voiceLoaded = false;

  constructor(locale: string = DEFAULT_LOCALE) {
    this.locale = locale;
  }

  /** 음성을 미리 로드한다. 첫 speak() 호출 전에 초기화할 수 있다. */
  async preloadVoice(): Promise<void> {
    if (this.voiceLoaded) return;
    const voices = await loadVoices();
    this.cachedVoice = selectVoiceForLocale(voices, this.locale);
    this.voiceLoaded = true;
  }

  speak(text: string): Promise<TtsPlaybackResult> {
    return new Promise<TtsPlaybackResult>((resolve, reject) => {
      // 이전 재생 중단
      this.cancel();

      const startAsync = async () => {
        // 음성이 캐시되지 않았으면 로드
        if (!this.voiceLoaded) {
          const voices = await loadVoices();
          this.cachedVoice = selectVoiceForLocale(voices, this.locale);
          this.voiceLoaded = true;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = this.rate;

        // 선택된 음성 지정 (Chrome onend 미발화 버그 방지)
        if (this.cachedVoice !== null) {
          utterance.voice = this.cachedVoice;
          utterance.lang = this.cachedVoice.lang;
        } else {
          utterance.lang = this.locale;
        }

        let startTime = performance.now();
        let settled = false;

        // 안전 타임아웃: onend가 발화하지 않을 경우 강제 resolve
        const safetyTimer = setTimeout(() => {
          if (!settled) {
            settled = true;
            const endTime = performance.now();
            resolve(
              Object.freeze<TtsPlaybackResult>({
                startTime,
                endTime,
                durationMs: endTime - startTime,
              }),
            );
          }
        }, TTS_SAFETY_TIMEOUT_MS);

        utterance.onstart = () => {
          startTime = performance.now();
        };

        utterance.onend = () => {
          if (settled) return;
          settled = true;
          clearTimeout(safetyTimer);
          const endTime = performance.now();
          resolve(
            Object.freeze<TtsPlaybackResult>({
              startTime,
              endTime,
              durationMs: endTime - startTime,
            }),
          );
        };

        utterance.onerror = (event) => {
          // canceled / interrupted 는 cancel() 호출에 의한 정상 중단이므로 무시
          if (event.error === 'canceled' || event.error === 'interrupted') {
            return;
          }
          if (settled) return;
          settled = true;
          clearTimeout(safetyTimer);
          reject(new Error(`TTS 재생 실패: ${event.error ?? '알 수 없는 오류'}`));
        };

        speechSynthesis.speak(utterance);
      };

      void startAsync().catch(reject);
    });
  }

  cancel(): void {
    if (speechSynthesis.speaking || speechSynthesis.pending) {
      speechSynthesis.cancel();
    }
  }
}
