// TTS 서비스 팩토리 — 환경에 따라 서버 TTS(Azure 뉴럴) 또는 Web Speech를 선택한다.
//
// 조립 시점에 엔진을 고정하되, 서버 실패 시 AzureTtsService 내부에서 Web Speech로
// 폴백하므로 항상 소리는 난다(로봇이라도 무음보다 낫다).
//  - 서버 TTS 가능(Audio 지원, 플래그 on) → AzureTtsService(사람 같은 SunHiNeural)
//  - 아니면 → WebSpeechTtsService (브라우저 내장, 로봇)
//
// VITE_USE_SERVER_TTS=false 로 강제 비활성화 가능(개발/오프라인/테스트).

import type { ITtsService } from '../domain/ITtsService.js';
import { AzureTtsService } from './AzureTtsService.js';
import { HtmlAudioPlayer } from './HtmlAudioPlayer.js';
import { WebSpeechTtsService } from './WebSpeechTtsService.js';

function canUseServerTts(): boolean {
  if (import.meta.env.VITE_USE_SERVER_TTS === 'false') return false;
  return typeof Audio !== 'undefined';
}

/**
 * 모범 발음 재생용 TTS 서비스를 생성한다.
 * 서버 TTS가 가능하면 Azure 뉴럴(사람 같음), 아니면 Web Speech로 폴백.
 */
export function createTtsService(): ITtsService {
  const fallback = new WebSpeechTtsService();
  if (!canUseServerTts()) return fallback;
  return new AzureTtsService(new HtmlAudioPlayer(), fallback);
}
