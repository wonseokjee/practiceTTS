/**
 * TTS 재생 상태 관리 훅
 *
 * ITtsService를 래핑하여 isPlaying, error 상태를 제공한다.
 * 컴포넌트 언마운트 시 자동으로 재생을 중단한다.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ITtsService, TtsPlaybackResult } from '../domain/ITtsService.js';

export interface UseTTSReturn {
  /** 현재 TTS 재생 중 여부 */
  isPlaying: boolean;
  /** 마지막 재생 오류 메시지. 정상 시 null */
  error: string | null;
  /**
   * TTS를 재생한다.
   * 완료 시 TtsPlaybackResult를 반환한다.
   * 실패 시 error 상태를 설정하고 null을 반환한다.
   */
  speak: (text: string) => Promise<TtsPlaybackResult | null>;
  /** TTS 재생을 즉시 중단한다 */
  cancel: () => void;
}

export function useTTS(ttsService: ITtsService): UseTTSReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ttsServiceRef = useRef(ttsService);

  // ref를 최신 서비스로 유지
  useEffect(() => {
    ttsServiceRef.current = ttsService;
  }, [ttsService]);

  // 컴포넌트 언마운트 시 재생 중단
  useEffect(() => {
    return () => {
      ttsServiceRef.current.cancel();
    };
  }, []);

  const speak = useCallback(
    async (text: string): Promise<TtsPlaybackResult | null> => {
      setError(null);
      setIsPlaying(true);

      try {
        const result = await ttsServiceRef.current.speak(text);
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : '알 수 없는 TTS 오류';
        setError(message);
        return null;
      } finally {
        setIsPlaying(false);
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    ttsServiceRef.current.cancel();
    setIsPlaying(false);
  }, []);

  return { isPlaying, error, speak, cancel };
}
