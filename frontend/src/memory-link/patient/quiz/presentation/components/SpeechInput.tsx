// 따라읽기 입력 (speech 유형)
//
// 회상이 아니라 "따라말하기(repetition)" 과제다. 짧은 단어를 보여주고(필요하면 들려주고)
// 환자가 따라 말한다. 실어증 회복의 기초 조음/발화 연습.
//
// 흐름: 단어 표시 → (선택) 🔊 들어보기(모범 발음) → 🎤 따라 말하기 → 관대한 STT 채점.
//   - 막히면 "넘어가기"로 보호자가 통과 처리(읽은 단어를 제출 → 정답 처리).
// TTS/STT는 훈련 기능에서 검증된 WebSpeechTtsService/WebSpeechSttService를 재사용한다.
// 피드백 단계 색상은 다른 유형과 동일 규칙 + 아이콘 동반.

import { useEffect, useMemo, useState } from 'react';
import { useTTS } from '../../../../../shared/hooks/useTTS.js';
import { TtsFailureNotice } from './TtsFailureNotice.js';
import { createTtsService } from '../../../../../shared/infrastructure/ttsFactory.js';
import { createSttService } from '../../infrastructure/sttFactory.js';

interface SpeechInputProps {
  /** 따라 읽을 단어 (speech 문항이면 항상 존재) */
  targetWord: string | null;
  isSelectable: boolean;
  showFeedback: boolean;
  /** 채점 결과 — 피드백 단계에서만 의미 */
  isCorrect: boolean | null;
  /** 정답 텍스트 — 피드백 단계 노출 */
  correctAnswer: string | null;
  onSubmit: (text: string) => void;
}

type SpeechStatus = 'idle' | 'listening' | 'recognized' | 'error';

/** 따라읽기(음성) 입력 */
export function SpeechInput({
  targetWord,
  isSelectable,
  showFeedback,
  isCorrect,
  correctAnswer,
  onSubmit,
}: SpeechInputProps) {
  const [status, setStatus] = useState<SpeechStatus>('idle');
  const [transcript, setTranscript] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const word = targetWord ?? '';

  // STT/TTS 서비스 인스턴스 (컴포넌트 생명주기와 동일). 문제 전환 시 부모가 key로 리마운트.
  const stt = useMemo(() => createSttService(), []);
  const ttsService = useMemo(() => createTtsService(), []);
  const { isPlaying, error: ttsError, speak } = useTTS(ttsService);

  // STT 콜백 프로퍼티 할당(TrainingScreen 등과 동일한 코드베이스 공통 패턴).
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    stt.onResult = (result) => {
      setTranscript(result.transcript);
      setStatus('recognized');
    };
    stt.onError = (message) => {
      setErrorMessage(message);
      setStatus('error');
    };
    return () => {
      stt.onResult = null;
      stt.onError = null;
      // 이탈 시 취소: 녹음된 음성을 서버로 업로드하지 않고 마이크만 해제한다.
      stt.cancel();
    };
  }, [stt]);
  /* eslint-enable react-hooks/immutability */

  const handleListenModel = (): void => {
    if (word.length === 0) return;
    void speak(word);
  };

  const handleStartRecord = (): void => {
    if (!isSelectable) return;
    setErrorMessage('');
    setStatus('listening');
    // 따라읽기 정답 단어를 phrase hint로 전달(서버 STT 제약 인식).
    stt.start(word.length > 0 ? [word] : undefined);
  };

  // 서버 STT는 자동 종료되지 않으므로 사용자가 발화 종료를 알린다(→ 인식 실행).
  // Web Speech는 stop()이 최종 결과를 확정한다. 두 구현 모두에서 안전.
  const handleStopRecord = (): void => {
    stt.stop();
  };

  const handleSubmitTranscript = (): void => {
    if (transcript.trim().length === 0) return;
    onSubmit(transcript.trim());
  };

  // "넘어가기": 보호자가 따라 읽었다고 보고 통과 처리. 보여준 단어를 제출 → 정답 처리.
  const handleSkip = (): void => {
    if (!isSelectable || word.length === 0) return;
    onSubmit(word);
  };

  // 인식 결과 박스 색상 (피드백 단계).
  let resultBoxClass = 'border-line-strong bg-white text-ink-sage';
  if (showFeedback) {
    resultBoxClass =
      isCorrect === true
        ? 'border-primary bg-primary-light text-primary-dark'
        : 'border-accent bg-accent-soft text-accent-ink';
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 따라 읽을 단어 (크게) */}
      <div
        className="flex min-h-[96px] items-center justify-center rounded-md border-2 border-line-strong bg-white px-5 py-6"
        aria-label={`따라 읽을 단어: ${word}`}
      >
        <span className="text-4xl font-bold tracking-wide text-ink-sage">
          {word || '—'}
        </span>
      </div>

      {/* 소리가 안 났으면 알린다 — 못 들은 발음은 따라 할 수 없다. */}
      {!showFeedback && ttsError !== null && <TtsFailureNotice />}

      {/* 모범 발음 듣기 (수동) — 피드백 단계엔 숨김 */}
      {!showFeedback && (
        <button
          type="button"
          onClick={handleListenModel}
          disabled={isPlaying || word.length === 0}
          className="flex min-h-[48px] items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-base font-medium text-primary ring-1 ring-inset ring-primary transition-colors duration-[180ms] ease-out hover:bg-primary-light disabled:cursor-not-allowed disabled:text-muted-faint disabled:ring-disabled-surface"
          aria-label="모범 발음 들어보기"
        >
          <span aria-hidden="true" className="text-xl">🔊</span>
          {isPlaying ? '재생 중…' : '들어보기'}
        </button>
      )}

      {/* 인식 결과 표시 (인식 완료 또는 피드백 단계) */}
      {(showFeedback || status === 'recognized') && (
        <div
          className={`flex min-h-[56px] items-center justify-between gap-3 rounded-md border-2 px-5 py-3 transition-colors duration-[180ms] ease-out ${resultBoxClass}`}
          aria-live="polite"
          aria-label={transcript ? `내가 말한 것: ${transcript}` : '인식 결과 없음'}
        >
          <span className="text-xl font-bold">{transcript || '—'}</span>
          {showFeedback && (
            <span className="text-2xl" aria-hidden="true">
              {isCorrect === true ? '✓' : '✗'}
            </span>
          )}
        </div>
      )}

      {showFeedback && isCorrect === false && correctAnswer !== null && (
        <p className="text-base text-muted-sage">
          정답:{' '}
          <span className="font-bold text-primary">{correctAnswer}</span>
        </p>
      )}

      {/* 안내/에러 메시지 (피드백 단계 제외) */}
      {!showFeedback && status === 'listening' && (
        <p className="text-base text-primary" role="status">
          듣고 있어요… 또박또박 따라 말씀해주세요.
        </p>
      )}
      {!showFeedback && status === 'error' && errorMessage.length > 0 && (
        <p className="text-base text-accent-ink" role="alert">
          {errorMessage}
        </p>
      )}

      {/* 컨트롤 (피드백 단계에선 숨김) */}
      {!showFeedback && (
        <div className="flex flex-col gap-3">
          {status === 'listening' ? (
            <button
              type="button"
              onClick={handleStopRecord}
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-accent-strong bg-white px-6 py-4 text-xl font-medium text-accent-ink transition-colors duration-[180ms] ease-out hover:bg-accent-soft"
              aria-label="다 말했어요"
            >
              <span aria-hidden="true" className="text-2xl">✓</span>
              다 말했어요
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartRecord}
              disabled={!isSelectable}
              className="flex min-h-[64px] items-center justify-center gap-2 rounded-md border-2 border-primary bg-white px-6 py-4 text-xl font-medium text-primary transition-colors duration-[180ms] ease-out hover:bg-primary-light disabled:cursor-not-allowed disabled:border-disabled-surface disabled:text-muted-faint"
              aria-label={status === 'idle' ? '따라 말하기' : '다시 말하기'}
            >
              <span aria-hidden="true" className="text-2xl">🎤</span>
              {status === 'idle' ? '따라 말하기' : '다시 말하기'}
            </button>
          )}

          {status === 'recognized' && (
            <button
              type="button"
              onClick={handleSubmitTranscript}
              disabled={!isSelectable || transcript.trim().length === 0}
              className="min-h-[56px] rounded-md bg-primary px-6 py-3 text-lg font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-disabled-surface disabled:text-disabled-ink"
              aria-label="제출"
            >
              제출
            </button>
          )}

          {/* 보호자가 옆에서 통과 처리 — 인식 실패해도 막히지 않게 */}
          <button
            type="button"
            onClick={handleSkip}
            disabled={!isSelectable || word.length === 0}
            className="min-h-[48px] rounded-md bg-white px-5 py-3 text-base font-medium text-muted-sage ring-1 ring-inset ring-line-strong transition-colors duration-[180ms] ease-out hover:bg-canvas-hover disabled:cursor-not-allowed disabled:text-disabled-surface"
            aria-label="넘어가기"
          >
            넘어가기
          </button>
        </div>
      )}
    </div>
  );
}
