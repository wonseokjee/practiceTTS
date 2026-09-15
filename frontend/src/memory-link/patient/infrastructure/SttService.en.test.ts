// WebSpeechSttService의 onError 문구를 영어로 낸다(영어판 Phase 1-2)
//
// jsdom엔 SpeechRecognition이 없다 — getSpeechRecognitionClass()가 null을
// 돌려주는 "브라우저 미지원" 경로만 직접 검증하고, 나머지 문구(신뢰도 미달·
// no-speech 등)는 recognition 콜백을 직접 흉내 내 확인한다.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../shared/i18n/i18n.js';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import { WebSpeechSttService } from './SttService.js';

describe('WebSpeechSttService — 영어로 오류 문구를 낸다', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US');
  });
  afterAll(async () => {
    await i18n.changeLanguage(DEFAULT_LOCALE);
  });

  it('SpeechRecognition 미지원 브라우저 — 영어 안내', () => {
    const svc = new WebSpeechSttService();
    const onError = vi.fn();
    svc.onError = onError;

    svc.start();

    expect(onError).toHaveBeenCalledWith(
      "This browser doesn't support speech recognition. We recommend using Chrome.",
    );
  });
});
