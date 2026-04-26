import { useState, useEffect, useRef, useCallback } from 'react';
import { useVAD } from '../../../shared/hooks/useVAD';
import { useAudioRecorder } from '../../../shared/hooks/useAudioRecorder';
import type { ReadingAloudItem, ReadingAloudResult } from '../domain/ReadingAloudTypes';

export type ReadingAloudStep = 'playing' | 'recording' | 'reviewing';

interface UseReadingAloudViewModelProps {
  item: ReadingAloudItem;
  onScored: (result: ReadingAloudResult) => void;
}

export function useReadingAloudViewModel({ item, onScored }: UseReadingAloudViewModelProps) {
  const [step, setStep] = useState<ReadingAloudStep>('playing');
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
    if (isMounted.current) {
      setStep('reviewing');
    }
    stopVAD();
    stopRecording();
    
    if (absoluteTimerRef.current) clearInterval(absoluteTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

    recordDurationMsRef.current = Date.now() - recordingStartTimeRef.current;
  }, [stopVAD, stopRecording]);

  useEffect(() => {
    if (step !== 'recording') return;

    if (isSpeaking) {
      hasStartedSpeaking.current = true;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    } else {
      if (hasStartedSpeaking.current && !silenceTimerRef.current) {
        silenceTimerRef.current = setTimeout(() => {
          finishRecording();
        }, 5000);
      }
    }
  }, [isSpeaking, step, finishRecording]);

  const handleInstructionEnded = () => {
    setStep('recording');
    setTimeLeft(15);
    hasStartedSpeaking.current = false;
    recordingStartTimeRef.current = Date.now();
    
    startVAD();
    startRecording();

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

  const submitReview = useCallback((isCorrect: boolean) => {
    cleanupRecording();

    const result: ReadingAloudResult = {
      itemId: item.itemId,
      textContent: item.textContent,
      isSelfEvaluated: true,
      isCorrect,
      recordDurationMs: recordDurationMsRef.current,
    };
    onScored(result);
  }, [item, onScored, cleanupRecording]);

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
