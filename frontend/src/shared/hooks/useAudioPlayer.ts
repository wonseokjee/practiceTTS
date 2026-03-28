/**
 * HtmlAudioPlayer를 React 훅으로 래핑한 편의 훅
 *
 * IAudioPlayer 인스턴스를 외부에서 주입받아 상태를 React 상태로 동기화한다.
 * useSentCompViewModel 내부의 Composition Root에서 생성한 HtmlAudioPlayer를
 * 컴포넌트에 전달할 때 사용한다.
 *
 * 현재 구현에서는 직접 사용되지 않지만,
 * 컴포넌트 레이어에서 isPlaying 상태가 필요할 때를 위해 제공한다.
 */

import { useState, useCallback } from 'react';
import type { IAudioPlayer } from '../domain/IAudioPlayer.js';

export interface UseAudioPlayerReturn {
  isPlaying: boolean;
  isLoaded: boolean;
  load: (url: string) => Promise<void>;
  play: () => Promise<number>;
  stop: () => void;
}

export function useAudioPlayer(player: IAudioPlayer): UseAudioPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const load = useCallback(
    async (url: string): Promise<void> => {
      setIsLoaded(false);
      await player.load(url);
      setIsLoaded(true);
    },
    [player],
  );

  const play = useCallback(async (): Promise<number> => {
    setIsPlaying(true);
    try {
      const endTimestamp = await player.play();
      setIsPlaying(false);
      return endTimestamp;
    } catch (err) {
      setIsPlaying(false);
      throw err;
    }
  }, [player]);

  const stop = useCallback(() => {
    player.stop();
    setIsPlaying(false);
  }, [player]);

  return { isPlaying, isLoaded, load, play, stop };
}
