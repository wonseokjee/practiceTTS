import { useCallback, useMemo, useRef, useState } from 'react';
import { WebSpeechTtsService } from '../../../shared/infrastructure/WebSpeechTtsService.js';
import { useTTS } from '../../../shared/hooks/useTTS.js';
import type { ConversationMessage, TrainingSession } from '../domain/TrainingSession.js';
import { trainingSessionApi } from '../infrastructure/TrainingSessionApi.js';


/** useTrainingSession 훅 Props */
export interface UseTrainingSessionProps {
  memoryEntryId: string;
  targetWord: string;
}

/** useTrainingSession 훅 반환 타입 */
export interface UseTrainingSessionReturn {
  /** 현재 세션 정보 (시작 전 null) */
  session: TrainingSession | null;
  /** 대화 이력 */
  messages: ConversationMessage[];
  /** API 호출 또는 처리 중 여부 */
  isLoading: boolean;
  /** TTS 재생 중 여부 */
  isSpeaking: boolean;
  /** 에러 메시지 (없으면 null) */
  error: string | null;
  /** 현재 힌트 단계 (0 | 1 | 2) */
  hintLevel: number;
  /** 세션 시작 (메모리 엔트리 기반 세션 생성 + AI 오프닝 질문 TTS 재생) */
  startSession: () => Promise<void>;
  /** 환자 발화 텍스트 전송 */
  sendMessage: (transcript: string) => Promise<void>;
  /** 힌트 레벨 1 증가 요청 */
  requestHint: () => Promise<void>;
  /** 세션 완료 처리 */
  completeSession: (success: boolean) => Promise<void>;
}

/**
 * 훈련 세션 상태 관리 훅
 *
 * 역할:
 * - Composition Root: TTS 서비스, API 클라이언트 인스턴스 조립
 * - 세션 생성/메시지 전송/힌트/완료 유스케이스 실행
 * - 대화 이력(messages) 관리
 * - AI 응답 자동 TTS 재생
 */
export function useTrainingSession({
  memoryEntryId,
  targetWord,
}: UseTrainingSessionProps): UseTrainingSessionReturn {
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [hintLevel, setHintLevel] = useState<number>(0);

  // Composition Root: TTS 서비스 인스턴스 (컴포넌트 생명주기와 동일)
  const ttsService = useMemo(() => new WebSpeechTtsService(), []);
  const { isPlaying: isSpeaking, speak } = useTTS(ttsService);

  // 세션 ID를 ref로 유지 (비동기 클로저에서 최신 값 참조)
  const sessionIdRef = useRef<string | null>(null);

  /** AI 메시지를 대화 이력에 추가하고 TTS 재생 */
  const addAiMessage = useCallback(
    async (content: string, hintTriggered = false): Promise<void> => {
      setMessages((prev) => [...prev, { role: 'ai', content, hintTriggered }]);
      await speak(content);
    },
    [speak],
  );

  /** 환자 발화를 대화 이력에 추가 */
  const addPatientMessage = useCallback((content: string): void => {
    setMessages((prev) => [...prev, { role: 'patient', content }]);
  }, []);

  /** Axios 에러에서 메시지를 안전하게 추출 */
  const extractErrorMessage = useCallback((err: unknown): string => {
    if (typeof err === 'object' && err !== null) {
      const obj = err as Record<string, unknown>;
      if (
        typeof obj.response === 'object' &&
        obj.response !== null
      ) {
        const responseData = (obj.response as Record<string, unknown>).data;
        if (
          typeof responseData === 'object' &&
          responseData !== null &&
          typeof (responseData as Record<string, unknown>).message === 'string'
        ) {
          return (responseData as Record<string, unknown>).message as string;
        }
      }
      if (err instanceof Error) return err.message;
    }
    return '알 수 없는 오류가 발생했습니다.';
  }, []);

  /**
   * UC-START: 훈련 세션 시작
   * 1. API로 세션 생성
   * 2. openingQuestion을 대화 이력에 추가 + TTS 재생
   */
  const startSession = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const newSession = await trainingSessionApi.create(memoryEntryId, targetWord);
      setSession(newSession);
      sessionIdRef.current = newSession.id;
      setHintLevel(newSession.hintLevel);

      // AI 오프닝 질문 TTS 재생
      if (newSession.openingQuestion) {
        await addAiMessage(newSession.openingQuestion);
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [memoryEntryId, targetWord, addAiMessage, extractErrorMessage]);

  /**
   * UC-MESSAGE: 환자 발화 전송
   * 1. 환자 발화를 대화 이력에 추가
   * 2. API로 전송 → AI 응답 수신
   * 3. AI 응답을 대화 이력에 추가 + TTS 재생
   */
  const sendMessage = useCallback(
    async (transcript: string): Promise<void> => {
      const currentSessionId = sessionIdRef.current;
      if (currentSessionId === null) {
        setError('세션이 시작되지 않았습니다.');
        return;
      }

      addPatientMessage(transcript);
      setIsLoading(true);
      setError(null);

      try {
        const response = await trainingSessionApi.sendMessage(
          currentSessionId,
          transcript,
        );

        setHintLevel(response.hintLevel);
        await addAiMessage(response.aiMessage, response.hintTriggered);
      } catch (err) {
        setError(extractErrorMessage(err));
      } finally {
        setIsLoading(false);
      }
    },
    [addPatientMessage, addAiMessage, extractErrorMessage],
  );

  /**
   * UC-HINT: 힌트 레벨 증가 요청
   * - API 호출 후 힌트 레벨 업데이트
   */
  const requestHint = useCallback(async (): Promise<void> => {
    const currentSessionId = sessionIdRef.current;
    if (currentSessionId === null) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await trainingSessionApi.incrementHint(currentSessionId);
      setHintLevel(result.hintLevel);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [extractErrorMessage]);

  /**
   * UC-COMPLETE: 세션 완료 처리
   */
  const completeSession = useCallback(
    async (success: boolean): Promise<void> => {
      const currentSessionId = sessionIdRef.current;
      if (currentSessionId === null) return;

      setIsLoading(true);
      setError(null);

      try {
        const completed = await trainingSessionApi.complete(
          currentSessionId,
          success,
        );
        setSession(completed);
      } catch (err) {
        setError(extractErrorMessage(err));
      } finally {
        setIsLoading(false);
      }
    },
    [extractErrorMessage],
  );

  return {
    session,
    messages,
    isLoading,
    isSpeaking,
    error,
    hintLevel,
    startSession,
    sendMessage,
    requestHint,
    completeSession,
  };
}
