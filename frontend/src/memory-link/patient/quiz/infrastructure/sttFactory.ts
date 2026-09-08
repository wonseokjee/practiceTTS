// STT 서비스 팩토리 — 환경에 따라 서버 STT(Azure) 또는 Web Speech를 선택한다.
//
// 조립 시점에 엔진을 고정한다(런타임 자동 폴백은 오디오 소실로 UX가 나빠 지양).
//  - 서버 STT 가능(마이크 API + AudioContext 지원, 플래그 on) → ServerSttService
//  - 아니면 → WebSpeechSttService (브라우저 내장, 오프라인)
//
// VITE_USE_SERVER_STT=false 로 강제 비활성화 가능(개발/오프라인).

import type { ISttService } from '../../infrastructure/SttService.js';
import { WebSpeechSttService } from '../../infrastructure/SttService.js';
import { ServerSttService } from './ServerSttService.js';
import { DEFAULT_LOCALE } from '../../../../shared/domain/locale.js';

function canUseServerStt(): boolean {
  if (import.meta.env.VITE_USE_SERVER_STT === 'false') return false;
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return false;
  }
  const hasMic =
    typeof navigator.mediaDevices?.getUserMedia === 'function';
  const hasAudioCtx =
    typeof window.AudioContext === 'function' ||
    typeof (window as unknown as { webkitAudioContext?: unknown })
      .webkitAudioContext === 'function';
  return hasMic && hasAudioCtx;
}

/**
 * 발화 인식용 STT 서비스를 생성한다.
 * 서버 STT가 가능하면 Azure(정확도↑, phrase hint), 아니면 Web Speech로 폴백.
 */
export function createSttService(lang: string = DEFAULT_LOCALE): ISttService {
  return canUseServerStt()
    ? new ServerSttService(lang)
    : new WebSpeechSttService();
}
