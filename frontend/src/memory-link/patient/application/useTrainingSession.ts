import { useCallback, useMemo, useRef, useState } from 'react';
import { createTtsService } from '../../../shared/infrastructure/ttsFactory.js';
import { useTTS } from '../../../shared/hooks/useTTS.js';
import type { ConversationMessage, TrainingSession } from '../domain/TrainingSession.js';
import { trainingSessionApi } from '../infrastructure/TrainingSessionApi.js';
import { extractErrorMessage } from '../../shared/extractErrorMessage.js';


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
  const ttsService = useMemo(() => createTtsService(), []);
  const { isPlaying: isSpeaking, speak } = useTTS(ttsService);

  // 세션 ID를 ref로 유지 (비동기 클로저에서 최신 값 참조)
  const sessionIdRef = useRef<string | null>(null);
  // 세션 시작 중복 방지 (React StrictMode의 useEffect 이중 실행 대응)
  const startedRef = useRef<boolean>(false);

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

  /**
   * UC-START: 훈련 세션 시작
   * 1. API로 세션 생성
   * 2. openingQuestion을 대화 이력에 추가 + TTS 재생
   */
  const startSession = useCallback(async (): Promise<void> => {
    // StrictMode 이중 호출 방지: 이미 시작했으면 중복 생성하지 않는다.
    if (startedRef.current) return;
    startedRef.current = true;

    setIsLoading(true);
    setError(null);

    try {
      const newSession = await trainingSessionApi.create(memoryEntryId, targetWord);
      setSession(newSession);
      sessionIdRef.current = newSession.id;
      setHintLevel(newSession.hintLevel);

      // 질문 텍스트 수신 완료 → '준비 중' 종료. 이후 음성 재생은 isSpeaking으로 표시.
      setIsLoading(false);

      // AI 오프닝 질문 TTS 재생
      if (newSession.openingQuestion) {
        await addAiMessage(newSession.openingQuestion);
      }
    } catch (err) {
      // 실패 시 가드를 풀어 재시도(돌아가기 후 재진입)를 허용한다.
      startedRef.current = false;
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [memoryEntryId, targetWord, addAiMessage]);

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
        // 응답 텍스트 수신 완료 → '준비 중' 종료. 이후 음성 재생은 isSpeaking으로 표시.
        setIsLoading(false);
        await addAiMessage(response.aiMessage, response.hintTriggered);
      } catch (err) {
        setError(extractErrorMessage(err));
      } finally {
        setIsLoading(false);
      }
    },
    [addPatientMessage, addAiMessage],
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
  }, []);

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
    [],
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
