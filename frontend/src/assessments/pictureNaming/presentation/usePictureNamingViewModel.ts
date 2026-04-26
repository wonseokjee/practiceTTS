import { useState, useEffect, useRef, useCallback } from 'react';
import { useVAD } from '../../../shared/hooks/useVAD';
import { useAudioRecorder } from '../../../shared/hooks/useAudioRecorder';
import type { PictureNamingItem, PictureNamingResult } from '../domain/PictureNamingTypes';

export type PictureNamingStep = 'playing' | 'recording' | 'reviewing';

interface UsePictureNamingViewModelProps {
  item: PictureNamingItem;
  onScored: (result: PictureNamingResult) => void;
}

export function usePictureNamingViewModel({ item, onScored }: UsePictureNamingViewModelProps) {
  const [step, setStep] = useState<PictureNamingStep>('playing');
  const [timeLeft, setTimeLeft] = useState(15);
  
  const { isSpeaking, startVAD, stopVAD } = useVAD({ throttleMs: 100 });
  const { audioUrl, startRecording, stopRecording, cleanupRecording } = useAudioRecorder();

  const isMounted = useRef(true);
  const hasStartedSpeaking = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const absoluteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const recordDurationMsRef = useRef<number>(0);

  const finishRecording = useCallback(() => {
    // 3. 상태 전환: 내 목소리 재생 블록이 있는 평가 화면(reviewing)
    if (isMounted.current) {
      setStep('reviewing');
    }
    stopVAD();
    stopRecording(); // 이 순간 audioUrl이 반환됨
    
    if (absoluteTimerRef.current) clearInterval(absoluteTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

    recordDurationMsRef.current = Date.now() - recordingStartTimeRef.current;
  }, [stopVAD, stopRecording]);

  // VAD 하이브리드 침묵 제어
  useEffect(() => {
    if (step !== 'recording') return;

    if (isSpeaking) {
      hasStartedSpeaking.current = true;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    } else {
      // 발화 후 최소 5초간 침묵 지속 시 조기 평가 진입
      if (hasStartedSpeaking.current && !silenceTimerRef.current) {
        silenceTimerRef.current = setTimeout(() => {
          finishRecording();
        }, 5000);
      }
    }
  }, [isSpeaking, step, finishRecording]);

  // 지시어 화면이 노출되고 즉시/일정시간 뒤 넘어가는 콜백
  const handleInstructionEnded = () => {
    setStep('recording');
    setTimeLeft(15);
    hasStartedSpeaking.current = false;
    recordingStartTimeRef.current = Date.now();
    
    startVAD();
    startRecording();

    // 환자 배려용 최장 15초 녹음 보장 타이머
    absoluteTimerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          finishRecording();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // 자가/보호자 평가 제출 완료 시
  const submitReview = useCallback((isCorrect: boolean) => {
    // 메모리 정리 후
    cleanupRecording();

    const result: PictureNamingResult = {
      itemId: item.itemId,
      expectedWord: item.expectedWord,
      isSelfEvaluated: true,
      isCorrect,
      recordDurationMs: recordDurationMsRef.current,
    };
    onScored(result); // 최종 결과 반환 및 다음 문항 진행
  }, [item, onScored, cleanupRecording]);

  // 언마운트 시 컴포넌트 정리
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (absoluteTimerRef.current) clearInterval(absoluteTimerRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      cleanupRecording();
    };
  }, [cleanupRecording]);

  return {
    step,
    timeLeft,
    isSpeaking,
    audioUrl,
    handleInstructionEnded,
    submitReview
  };
}
