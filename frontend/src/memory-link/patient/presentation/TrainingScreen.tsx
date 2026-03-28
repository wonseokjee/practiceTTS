import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationMessage } from '../domain/TrainingSession.js';
import { WebSpeechSttService } from '../infrastructure/SttService.js';
import { useSilenceDetector } from '../application/useSilenceDetector.js';
import { useTrainingSession } from '../application/useTrainingSession.js';

interface TrainingScreenProps {
  memoryEntryId: string;
  targetWord: string;
  onComplete: () => void;
}

/**
 * 환자 훈련 화면
 *
 * 접근성 원칙:
 * - 모든 텍스트: text-2xl 이상
 * - 터치 영역: min-h-[48px] 이상
 * - 흰 배경 / 검정 텍스트 고대비
 * - 음성 우선 인터페이스
 *
 * 침묵 감지 흐름:
 * - STT 대기 중 10초 침묵 → 힌트 레벨 자동 증가
 * - STT 결과 수신 시 타이머 리셋
 */
export function TrainingScreen({
  memoryEntryId,
  targetWord,
  onComplete,
}: TrainingScreenProps) {
  const {
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
  } = useTrainingSession({ memoryEntryId, targetWord });

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [sttError, setSttError] = useState<string | null>(null);

  // 대화 이력 스크롤 컨테이너 ref
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // STT 서비스 인스턴스 (컴포넌트 생명주기와 동일)
  const sttService = useMemo(() => new WebSpeechSttService(), []);

  // 침묵 감지: STT 대기 중 10초 경과 시 힌트 자동 증가
  const handleSilence = useCallback(async () => {
    if (session?.status === 'active' && hintLevel < 2) {
      await requestHint();
    }
  }, [session, hintLevel, requestHint]);

  const { resetTimer } = useSilenceDetector({
    onSilence: handleSilence,
    timeoutMs: 10_000,
    isActive: isRecording && !isSpeaking,
  });

  // 새 메시지 도착 시 스크롤 하단으로 이동
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // STT 서비스 콜백 설정
  useEffect(() => {
    sttService.onResult = async (result) => {
      setIsRecording(false);
      setSttError(null);
      resetTimer();
      await sendMessage(result.transcript);
    };

    sttService.onError = (errorMessage) => {
      setIsRecording(false);
      setSttError(errorMessage);
    };
  }, [sttService, sendMessage, resetTimer]);

  // 세션 자동 시작 (컴포넌트 마운트 시)
  useEffect(() => {
    void startSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 컴포넌트 언마운트 시 STT 중단
  useEffect(() => {
    return () => {
      sttService.stop();
    };
  }, [sttService]);

  /** 마이크 버튼 클릭 핸들러 */
  const handleMicClick = useCallback(() => {
    if (isRecording) {
      sttService.stop();
      setIsRecording(false);
    } else {
      setSttError(null);
      setIsRecording(true);
      sttService.start();
    }
  }, [isRecording, sttService]);

  /** 힌트 요청 버튼 핸들러 */
  const handleHintRequest = useCallback(async () => {
    await requestHint();
  }, [requestHint]);

  /** 훈련 성공 완료 핸들러 */
  const handleSuccess = useCallback(async () => {
    await completeSession(true);
    onComplete();
  }, [completeSession, onComplete]);

  /** 훈련 포기 핸들러 */
  const handleGiveUp = useCallback(async () => {
    await completeSession(false);
    onComplete();
  }, [completeSession, onComplete]);

  // 로딩 상태 (세션 시작 전)
  if (session === null && isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-2xl text-gray-700">훈련을 준비하고 있습니다...</p>
      </div>
    );
  }

  // 세션 시작 실패
  if (session === null && error !== null) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 gap-6">
        <p className="text-2xl text-red-600 text-center" role="alert">
          훈련을 시작할 수 없습니다.
        </p>
        <p className="text-xl text-gray-600 text-center">{error}</p>
        <button
          type="button"
          onClick={onComplete}
          className="min-h-[48px] px-8 py-3 bg-gray-200 text-gray-800 text-xl font-semibold rounded-2xl"
        >
          돌아가기
        </button>
      </div>
    );
  }

  const isSessionCompleted = session?.status === 'completed';
  const canRequestHint = !isLoading && !isSpeaking && !isRecording && hintLevel < 2;
  const canRecord = !isLoading && !isSpeaking && session?.status === 'active';

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">기억 훈련</h1>
        {/* 힌트 단계 표시 */}
        <div className="flex items-center gap-2" aria-label={`힌트 단계 ${hintLevel}/2`}>
          {[0, 1, 2].map((level) => (
            <div
              key={level}
              className={`w-4 h-4 rounded-full ${
                level <= hintLevel ? 'bg-blue-500' : 'bg-gray-200'
              }`}
              aria-hidden="true"
            />
          ))}
          <span className="text-lg text-gray-600 ml-1">힌트</span>
        </div>
      </header>

      {/* 대화 이력 영역 */}
      <main
        className="flex-1 overflow-y-auto px-6 py-4"
        aria-label="대화 내용"
        aria-live="polite"
      >
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          {messages.map((msg, index) => (
            <MessageBubble key={index} message={msg} />
          ))}

          {/* 로딩 인디케이터 */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl px-5 py-4">
                <p className="text-2xl text-gray-500">답변을 생성하고 있어요...</p>
              </div>
            </div>
          )}

          {/* TTS 재생 중 표시 */}
          {isSpeaking && (
            <div
              className="flex items-center gap-2 text-blue-600"
              aria-live="assertive"
              role="status"
            >
              <span className="text-2xl">음성을 재생하고 있어요</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* 에러 메시지 */}
      {(error !== null || sttError !== null) && (
        <div className="px-6 py-3 bg-red-50 border-t border-red-200">
          <p
            className="text-xl text-red-700 text-center"
            role="alert"
            aria-live="assertive"
          >
            {error ?? sttError}
          </p>
        </div>
      )}

      {/* 하단 컨트롤 영역 */}
      <footer className="bg-white border-t border-gray-200 px-6 py-6">
        <div className="max-w-2xl mx-auto">
          {/* STT 녹음 중 표시 */}
          {isRecording && (
            <p
              className="text-center text-2xl text-red-600 font-semibold mb-4"
              role="status"
              aria-live="polite"
            >
              듣고 있어요... 말씀해주세요
            </p>
          )}

          <div className="flex items-center justify-center gap-4">
            {/* 힌트 버튼 */}
            {canRequestHint && (
              <button
                type="button"
                onClick={handleHintRequest}
                disabled={isLoading}
                className="min-h-[48px] px-6 py-3 bg-yellow-100 text-yellow-800 text-xl font-semibold rounded-2xl border-2 border-yellow-300 disabled:opacity-50 active:scale-95 transition-transform"
                aria-label="힌트 요청"
              >
                힌트 ({hintLevel}/2)
              </button>
            )}

            {/* 마이크 버튼 (메인 액션) */}
            {!isSessionCompleted && (
              <button
                type="button"
                onClick={handleMicClick}
                disabled={!canRecord}
                className={`min-h-[80px] min-w-[80px] rounded-full text-white text-3xl font-bold transition-all active:scale-95 disabled:opacity-50 ${
                  isRecording
                    ? 'bg-red-500 scale-110 shadow-lg shadow-red-300'
                    : 'bg-blue-600 hover:bg-blue-700 shadow-md'
                }`}
                aria-label={isRecording ? '녹음 중지' : '말하기'}
                aria-pressed={isRecording}
              >
                {isRecording ? '■' : '●'}
              </button>
            )}

            {/* 완료 버튼 */}
            {session?.status === 'active' && !isLoading && (
              <button
                type="button"
                onClick={handleSuccess}
                className="min-h-[48px] px-6 py-3 bg-green-600 text-white text-xl font-semibold rounded-2xl active:scale-95 transition-transform"
                aria-label="훈련 성공으로 완료"
              >
                완료
              </button>
            )}
          </div>

          {/* 포기 버튼 */}
          {session?.status === 'active' && !isLoading && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={handleGiveUp}
                className="min-h-[48px] px-6 py-2 text-gray-500 text-lg underline active:scale-95 transition-transform"
                aria-label="훈련 중단"
              >
                훈련 중단하기
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}

// ─── 보조 컴포넌트 ──────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: ConversationMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isAi = message.role === 'ai';

  return (
    <div
      className={`flex ${isAi ? 'justify-start' : 'justify-end'}`}
      role="listitem"
    >
      <div
        className={`max-w-[85%] rounded-2xl px-5 py-4 ${
          isAi
            ? 'bg-gray-100 text-gray-900'
            : 'bg-blue-600 text-white'
        }`}
      >
        {/* 발화자 레이블 */}
        <p
          className={`text-sm font-semibold mb-1 ${
            isAi ? 'text-gray-500' : 'text-blue-200'
          }`}
        >
          {isAi ? 'AI' : '나'}
        </p>
        <p className="text-2xl leading-relaxed">{message.content}</p>
        {/* 힌트 트리거 표시 */}
        {message.hintTriggered === true && (
          <p className="text-sm text-yellow-600 mt-1">힌트 포함</p>
        )}
      </div>
    </div>
  );
}
