import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WebSpeechSttService } from '../infrastructure/SttService.js';
import { useSilenceDetector } from '../application/useSilenceDetector.js';
import { useTrainingSession } from '../application/useTrainingSession.js';
import { WARM_SCREEN_BG } from '../../shared/theme.js';
import { AuthedImage } from '../../shared/AuthedImage.js';

interface TrainingScreenProps {
  memoryEntryId: string;
  targetWord: string;
  /** 회상 단서 사진 URL (없으면 플레이스홀더 표시) */
  photoUrl?: string | null;
  /** 사진 캡션용 장소 태그 */
  locationTag?: string | null;
  onComplete: () => void;
}

/** 배경 그라데이션은 환자 흐름 화면 공통 상수(WARM_SCREEN_BG)를 사용한다. */
const SCREEN_BG = WARM_SCREEN_BG;

/**
 * 환자 훈련 화면 (디자인 시안 A: 따뜻한 회상)
 *
 * 레이아웃:
 * - 상단: 회상 단서 사진(둥근 카드)
 * - 가운데: 현재 AI 질문 한 장(반투명 흰 카드) — 채팅 이력 누적 대신 질문 하나에 집중
 * - 하단: 힌트 · 테라코타 마이크 · 완료
 *
 * 접근성 원칙:
 * - 모든 텍스트: text-2xl 이상
 * - 터치 영역: min-h-[48px] 이상
 * - Warm Clinical 토큰 (세이지 그린/크림/테라코타), 파란색 미사용
 * - 음성 우선 인터페이스
 *
 * 침묵 감지 흐름:
 * - STT 대기 중 10초 침묵 → 힌트 레벨 자동 증가
 * - STT 결과 수신 시 타이머 리셋
 */
export function TrainingScreen({
  memoryEntryId,
  targetWord,
  photoUrl = null,
  locationTag = null,
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

  // STT 서비스 인스턴스 (컴포넌트 생명주기와 동일)
  const sttService = useMemo(() => new WebSpeechSttService(), []);

  // 가운데 카드에 표시할 최신 AI 질문 / 환자 발화 (채팅 누적 대신 마지막 발화만 강조)
  const latestAiMessage = useMemo(
    () => [...messages].reverse().find((msg) => msg.role === 'ai') ?? null,
    [messages],
  );
  const latestPatientMessage = useMemo(
    () => [...messages].reverse().find((msg) => msg.role === 'patient') ?? null,
    [messages],
  );

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

  // sendMessage/resetTimer를 ref로 미러링한다.
  // (resetTimer는 isRecording/isSpeaking 토글마다 새 함수가 되므로, 콜백 등록
  //  effect가 매번 재실행되어 onResult/onError를 재할당하던 것을 방지한다.)
  const sendMessageRef = useRef(sendMessage);
  const resetTimerRef = useRef(resetTimer);
  useEffect(() => {
    sendMessageRef.current = sendMessage;
    resetTimerRef.current = resetTimer;
  });

  // STT 서비스 콜백 설정 — sttService 생명주기당 1회만 등록(ref로 최신 함수 참조).
  useEffect(() => {
    sttService.onResult = async (result) => {
      setIsRecording(false);
      setSttError(null);
      resetTimerRef.current();
      await sendMessageRef.current(result.transcript);
    };

    sttService.onError = (errorMessage) => {
      setIsRecording(false);
      setSttError(errorMessage);
    };
  }, [sttService]);

  // 세션 자동 시작 (컴포넌트 마운트 시)
  useEffect(() => {
    void startSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 컴포넌트 언마운트 시 STT 취소(녹음 음성을 서버로 업로드하지 않고 마이크 해제)
  useEffect(() => {
    return () => {
      sttService.cancel();
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
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: SCREEN_BG }}
      >
        <p className="text-2xl text-[#6B6560]">훈련을 준비하고 있습니다...</p>
      </div>
    );
  }

  // 세션 시작 실패
  if (session === null && error !== null) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 gap-6"
        style={{ background: SCREEN_BG }}
      >
        <p className="text-2xl text-[#C94040] text-center font-semibold" role="alert">
          훈련을 시작할 수 없습니다.
        </p>
        <p className="text-xl text-[#6B6560] text-center">{error}</p>
        <button
          type="button"
          onClick={onComplete}
          className="min-h-[48px] px-8 py-3 bg-white/80 text-[#1A1916] text-xl font-semibold rounded-full border border-[#E8E4DC]"
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
    <div className="min-h-screen flex flex-col" style={{ background: SCREEN_BG }}>
      {/* 헤더 */}
      <header className="px-6 py-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1916]">기억 훈련</h1>
        {/* 힌트 단계 표시 */}
        <div className="flex items-center gap-2" aria-label={`힌트 단계 ${hintLevel}/2`}>
          <span className="text-base text-[#6B6560] mr-1">힌트</span>
          {[0, 1, 2].map((level) => (
            <div
              key={level}
              className={`w-3 h-3 rounded-full ${
                level <= hintLevel ? 'bg-[#2D6A56]' : 'bg-[#E8E4DC]'
              }`}
              aria-hidden="true"
            />
          ))}
        </div>
      </header>

      {/* 본문 — 사진 단서 + 현재 질문 한 장 */}
      <main
        className="flex-1 flex flex-col px-5 pb-2 max-w-2xl w-full mx-auto"
        aria-label="대화 내용"
        aria-live="polite"
      >
        {/* 회상 단서 사진 */}
        <div className="mt-2">
          {photoUrl !== null ? (
            <AuthedImage
              src={photoUrl}
              alt={locationTag !== null ? `${locationTag} 사진` : '기억 사진'}
              className="w-full h-44 object-cover rounded-3xl shadow-[0_8px_22px_rgba(45,106,86,0.10)]"
            />
          ) : (
            <div
              className="w-full h-44 rounded-3xl flex items-center justify-center shadow-[0_8px_22px_rgba(45,106,86,0.10)]"
              style={{
                background:
                  'radial-gradient(120% 80% at 30% 20%,#f3d9c4 0%,transparent 60%),linear-gradient(160deg,#e8c9a8 0%,#cbb79a 55%,#9aa890 100%)',
              }}
              aria-hidden="true"
            >
              <span className="text-5xl opacity-70">🖼️</span>
            </div>
          )}
          {locationTag !== null && (
            <p className="mt-2 text-center text-lg text-[#6B6560]">{locationTag}</p>
          )}
        </div>

        {/* 현재 질문 카드 (반투명 흰 카드) */}
        <div className="flex-1 flex flex-col justify-center py-4">
          <div className="bg-white/85 border border-white/90 rounded-3xl px-6 py-6 shadow-[0_6px_18px_rgba(0,0,0,0.05)]">
            <span className="text-sm font-bold text-[#2D6A56]">AI 선생님</span>

            {isLoading ? (
              /* AI 질문 준비 중 */
              <div className="mt-3 flex items-center gap-2" role="status" aria-label="질문 준비 중">
                <span className="flex gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#9fd0bc] animate-pulse [animation-delay:0ms]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#9fd0bc] animate-pulse [animation-delay:200ms]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#9fd0bc] animate-pulse [animation-delay:400ms]" />
                </span>
                <span className="text-xl text-[#6B6560]">질문을 준비하고 있어요</span>
              </div>
            ) : latestAiMessage !== null ? (
              <p className="mt-3 text-2xl leading-relaxed font-semibold text-[#1A1916]">
                {latestAiMessage.content}
              </p>
            ) : (
              <p className="mt-3 text-2xl leading-relaxed text-[#6B6560]">
                잠시만 기다려 주세요.
              </p>
            )}

            {/* TTS 재생 중 표시 */}
            {isSpeaking && (
              <p
                className="mt-3 text-lg text-[#2D6A56]"
                aria-live="assertive"
                role="status"
              >
                🔊 질문을 읽어드리고 있어요
              </p>
            )}
          </div>

          {/* 환자의 마지막 답변 (맥락 유지용, 작게) */}
          {latestPatientMessage !== null && !isRecording && (
            <p className="mt-3 px-2 text-center text-lg text-[#6B6560]">
              방금 이렇게 답하셨어요 · “{latestPatientMessage.content}”
            </p>
          )}
        </div>
      </main>

      {/* 에러 메시지 */}
      {(error !== null || sttError !== null) && (
        <div className="px-6 py-3 mx-5 mb-2 bg-[#C94040]/10 border border-[#C94040]/30 rounded-2xl">
          <p
            className="text-xl text-[#C94040] text-center"
            role="alert"
            aria-live="assertive"
          >
            {error ?? sttError}
          </p>
        </div>
      )}

      {/* 하단 컨트롤 영역 */}
      <footer className="px-6 pb-8 pt-2">
        <div className="max-w-2xl mx-auto flex flex-col items-center gap-4">
          {/* STT 녹음 중 안내 */}
          {isRecording && (
            <p
              className="text-2xl text-[#C94040] font-semibold"
              role="status"
              aria-live="polite"
            >
              듣고 있어요... 말씀해주세요
            </p>
          )}

          <div className="flex items-center justify-center gap-5">
            {/* 힌트 버튼 */}
            {canRequestHint && (
              <button
                type="button"
                onClick={handleHintRequest}
                disabled={isLoading}
                className="min-h-[52px] px-5 py-3 bg-white/70 text-[#2D6A56] text-xl font-bold rounded-full disabled:opacity-50 active:scale-95 transition-transform"
                aria-label="힌트 요청"
              >
                힌트 {hintLevel}/2
              </button>
            )}

            {/* 마이크 버튼 (메인 액션) */}
            {!isSessionCompleted && (
              <button
                type="button"
                onClick={handleMicClick}
                disabled={!canRecord && !isRecording}
                className={`min-h-[84px] min-w-[84px] rounded-full text-white text-3xl font-bold transition-all active:scale-95 disabled:opacity-50 ${
                  isRecording
                    ? 'bg-[#C94040] scale-110 shadow-lg shadow-[#C94040]/40'
                    : 'bg-[#E07B54] shadow-[0_10px_24px_rgba(224,123,84,0.45)]'
                }`}
                aria-label={isRecording ? '녹음 중지' : '말하기'}
                aria-pressed={isRecording}
              >
                {isRecording ? '■' : '🎤'}
              </button>
            )}

            {/* 완료 버튼 */}
            {session?.status === 'active' && !isLoading && (
              <button
                type="button"
                onClick={handleSuccess}
                className="min-h-[52px] px-5 py-3 bg-white/70 text-[#6B6560] text-xl font-bold rounded-full active:scale-95 transition-transform"
                aria-label="훈련 성공으로 완료"
              >
                완료
              </button>
            )}
          </div>

          {/* 안내 문구 */}
          {!isRecording && canRecord && (
            <span className="text-base text-[#6B6560]">버튼을 누르고 말씀해 주세요</span>
          )}

          {/* 포기 버튼 */}
          {session?.status === 'active' && !isLoading && (
            <button
              type="button"
              onClick={handleGiveUp}
              className="min-h-[44px] px-6 py-2 text-[#6B6560] text-lg underline active:scale-95 transition-transform"
              aria-label="훈련 중단"
            >
              훈련 중단하기
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
