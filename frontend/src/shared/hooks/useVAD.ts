import { useState, useRef, useEffect, useCallback } from 'react';

interface UseVADOptions {
  threshold?: number;
  throttleMs?: number;
}

export function useVAD({ threshold = 10, throttleMs = 100 }: UseVADOptions = {}) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const animationFrameRef = useRef<number | null>(null);
  const lastCheckTimeRef = useRef<number>(0);

  const startVAD = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

      const checkAudioLevel = (timestamp: number) => {
        // [Performance] 약속된 100ms 주기로만(Throttling) 에너지를 계산하여 브라우저 버벅거림 방지
        if (timestamp - lastCheckTimeRef.current >= throttleMs) {
          if (analyserRef.current && dataArrayRef.current) {
            analyserRef.current.getByteFrequencyData(dataArrayRef.current);
            let sum = 0;
            for (let i = 0; i < dataArrayRef.current.length; i++) {
              sum += dataArrayRef.current[i];
            }
            const average = sum / dataArrayRef.current.length;

            setIsSpeaking(average > threshold);
          }
          lastCheckTimeRef.current = timestamp;
        }
        animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
      };

      animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
    } catch (err) {
      console.error('Failed to initialize VAD', err);
      // 권한 거부 등 에러 상황 시 무시
    }
  }, [threshold, throttleMs]);

  const stopVAD = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    return () => {
      stopVAD();
    };
  }, [stopVAD]);

  return { isSpeaking, startVAD, stopVAD };
}
