import { useState, useEffect, useRef, useCallback } from 'react';
import { useVAD } from '../../../shared/hooks/useVAD';
import { calculateScore } from '../domain/cerCalculator';
import type { RepetitionItem, RepetitionResult } from '../domain/RepetitionTypes';

export type RepetitionStep = 'playing' | 'recording' | 'scoring';

interface UseRepetitionViewModelProps {
  item: RepetitionItem;
  onScored: (result: RepetitionResult) => void;
}

export function useRepetitionViewModel({ item, onScored }: UseRepetitionViewModelProps) {
  // 상태 1: 오디오 재생 中 (playing)
  // 상태 2: 사용자 발화 대기 및 녹음 中 (recording)
  // 상태 3: STT 결과 대기 및 채점 (scoring) - 블로킹 로딩 레이어 표시 목적
  const [step, setStep] = useState<RepetitionStep>('playing');
  const [timeLeft, setTimeLeft] = useState(15);
  
  const { isSpeaking, startVAD, stopVAD } = useVAD({ throttleMs: 100 });
  const [SpeechRecognition] = useState(() => (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const recognitionRef = useRef<any>(null);
  const isSttSupported = !!SpeechRecognition; // STT 지원 브라우저 여부

  const hasStartedSpeaking = useRef(false);
  const isMounted = useRef(true); // 컴포넌트 마운트 수명 상태 추적용
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const absoluteTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const sttResultRef = useRef<string>('');
  
  const MOCK_STT_DELAY_MS = 1500;

  const finishRecording = useCallback(async () => {
    // 1. 상태 전환: "분석 중..." (터치 블로킹 목적) -> Issue 3A

    setStep('scoring');
    stopVAD();
    
    if (absoluteTimerRef.current) clearInterval(absoluteTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (recognitionRef.current) recognitionRef.current.stop();

    const recordDurationMs = Date.now() - recordingStartTimeRef.current;
    
    // 네트워크 지연 흉내 (실제 클라우드 STT 사용 시 비동기 fetch 대기 영역)
    await new Promise(resolve => setTimeout(resolve, MOCK_STT_DELAY_MS));
    
    // 컴포넌트가 대기(await) 도중 이미 언마운트(뒤로가기 등) 되었다면 렌더링 에러 방지 (Low Issue)
    if (!isMounted.current) return;
    
    const finalStt = sttResultRef.current.trim();
    
    // 2. CER 기반 로직 채점 호출 -> Issue 1A
    const cerResult = calculateScore(item.stimulusText, finalStt);

    const result: RepetitionResult = {
      itemId: item.itemId,
      stimulusText: item.stimulusText,
      sttOutput: finalStt,
      cer: cerResult.cer,
      score: cerResult.score,
      isCorrect: cerResult.isCorrect,
      reactionTimeMs: 0, 
      recordDurationMs
    };

    onScored(result);
  }, [item, onScored, stopVAD]);

  // STT 객체 초기 셋업
  useEffect(() => {
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ko-KR';
      recognition.continuous = true;
      recognition.interimResults = true;
      
      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        sttResultRef.current = transcript;
      };
      recognition.onerror = () => { /* 에러 시 네트워크 분기 처리 등 */ };
      recognitionRef.current = recognition;
    }
  }, [SpeechRecognition]);

  // VAD(음성 감지)를 통한 하이브리드 수명주기(침묵 제어) 통제 -> Issue 2A
  useEffect(() => {
    if (step !== 'recording') return;

    if (isSpeaking) {
      hasStartedSpeaking.current = true;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    } else {
      // 말을 하다가 멈췄고, 그 침묵이 5초 이상 지속되면 환자를 돕기위해 조기 종료
      if (hasStartedSpeaking.current && !silenceTimerRef.current) {
        silenceTimerRef.current = setTimeout(() => {
          finishRecording();
        }, 5000);
      }
    }
  }, [isSpeaking, step, finishRecording]);

  const handleAudioEnded = () => {
    setStep('recording');
    setTimeLeft(15);
    hasStartedSpeaking.current = false;
    sttResultRef.current = '';
    recordingStartTimeRef.current = Date.now();
    
    startVAD();
    if (recognitionRef.current) {
      try { recognitionRef.current.start(); } catch (e) {}
    }

    // 15초 절대 타이머 파이프라인
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

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      if (absoluteTimerRef.current) clearInterval(absoluteTimerRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  return {
    step,
    timeLeft,
    isSpeaking,
    isSttSupported,
    handleAudioEnded,
  };
}
