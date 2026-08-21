// QAB 이미지 선택형 문항 렌더러 (kind 'qab')
//
// 들려주는 단어/문장(promptText)을 듣고 그에 맞는 그림을 고른다(QAB wordComp/sentComp 공용).
// 음성은 mp3 대신 TTS(서버 Azure 뉴럴 → Web Speech 폴백)로 발음한다 → 문항 확장이 자유롭다.
// 피드백 단계: 정답 카드 초록 + ✓, 내가 고른 오답 카드 빨강 + ✗.
//
// 로딩 중에는 그림의 정답(라벨)을 절대 노출하지 않는다 — 중립 로딩/에러 표시만 사용.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTTS } from '../../../../../shared/hooks/useTTS.js';
import { createTtsService } from '../../../../../shared/infrastructure/ttsFactory.js';
import type { QabImageItem } from '../../domain/MixedQuiz.js';

/**
 * 선택지 그림 — 로딩/실패 상태를 자체 관리한다.
 * 로딩 전까지 이미지를 투명 처리하고, 라벨이 아닌 중립 표시만 보여 정답 노출을 막는다.
 */
function ChoiceImage({ src }: { src: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    'loading',
  );
  return (
    <>
      {status !== 'loaded' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[#F2F1ED] text-[#A8AFA9]"
          aria-hidden="true"
          style={{ zIndex: 0 }}
        >
          {status === 'loading' ? (
            <span className="animate-pulse text-3xl">🖼️</span>
          ) : (
            <>
              <span className="text-2xl">🖼️</span>
              <span className="text-xs">그림을 불러올 수 없어요</span>
            </>
          )}
        </div>
      )}
      <img
        src={src}
        alt=""
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-150"
        loading="eager"
        // 로드 완료 전엔 투명 → 깨진 이미지 아이콘/alt가 정답을 흘리지 않게 한다.
        style={{ zIndex: 1, opacity: status === 'loaded' ? 1 : 0 }}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
    </>
  );
}

interface ImageChoiceQuizItemProps {
  item: QabImageItem;
  isSelectable: boolean;
  showFeedback: boolean;
  /**
   * 피드백을 **정답 안내로만** 쓴다(연습 모드).
   *
   * 검사는 채점하려고 피드백을 켠다 — 정답 초록✓ + 내 오답 빨강✗. 연습은
   * 가르치려고 켠다. 틀린 연결이 굳는 것만 막으면 되므로 정답 카드만 표시하고
   * ✗·빨강은 쓰지 않는다. 성적표가 아니라 안내다.
   */
  answerOnly?: boolean;
  /** 사용자가 고른 선택지 id (피드백 단계 강조용) */
  selectedChoiceId: string | null;
  onSelect: (choiceId: string) => void;
}

/** 단어/문장 이해(듣고 그림 고르기) 문항 */
export function ImageChoiceQuizItem({
  item,
  isSelectable,
  showFeedback,
  answerOnly = false,
  selectedChoiceId,
  onSelect,
}: ImageChoiceQuizItemProps) {
  const ttsService = useMemo(() => createTtsService(), []);
  const { isPlaying, speak } = useTTS(ttsService);

  // 문항 진입 시 1회 자동 발음 (브라우저 정책상 막히면 버튼으로 재생).
  const autoPlayedRef = useRef(false);
  useEffect(() => {
    if (autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    void speak(item.promptText);
  }, [speak, item.promptText]);

  const listenLabel = item.category === 'sentence' ? '문장 듣기' : '단어 듣기';

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-[#5C6661]">{item.instruction}</p>

      <button
        type="button"
        onClick={() => void speak(item.promptText)}
        disabled={isPlaying}
        className="flex min-h-[56px] items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-lg font-medium text-[#2D6A56] ring-1 ring-inset ring-[#2D6A56] transition-colors duration-[180ms] ease-out hover:bg-[#EBF4F0] disabled:cursor-not-allowed disabled:text-[#A8AFA9] disabled:ring-[#C5C8C5]"
        aria-label={`${listenLabel} 다시 듣기`}
      >
        <span aria-hidden="true" className="text-2xl">🔊</span>
        {isPlaying ? '재생 중…' : listenLabel}
      </button>

      <div
        className="grid grid-cols-2 gap-3"
        role="group"
        aria-label="그림 선택지"
      >
        {item.choices.map((choice) => {
          const isChosen = selectedChoiceId === choice.choiceId;

          // 피드백 단계 강조: 정답=초록, 내가 고른 오답=빨강.
          let ring = 'border-[#E5E5E0]';
          let icon: string | null = null;
          if (showFeedback && answerOnly) {
            // 연습: 정답만 알려준다. ✗도 빨강도 없다.
            ring = choice.isCorrect
              ? 'border-[#2D6A56]'
              : 'border-[#E5E5E0] opacity-50';
          } else if (showFeedback) {
            if (choice.isCorrect) {
              ring = 'border-[#2D6A56]';
              icon = '✓';
            } else if (isChosen) {
              ring = 'border-[#E07B54]';
              icon = '✗';
            } else {
              ring = 'border-[#E5E5E0] opacity-60';
            }
          } else if (isChosen) {
            ring = 'border-[#2D6A56]';
          }

          return (
            <button
              key={choice.choiceId}
              type="button"
              disabled={!isSelectable}
              onClick={() => {
                if (isSelectable) onSelect(choice.choiceId);
              }}
              aria-label={`${choice.label} 선택`}
              className={`relative aspect-square w-full overflow-hidden rounded-2xl border-4 transition-all duration-150 disabled:cursor-default ${ring} ${
                isSelectable ? 'hover:border-[#A8AFA9] active:scale-[0.97]' : ''
              }`}
            >
              {/* 그림 — 로딩/실패 시 라벨(정답) 노출 없이 중립 표시 */}
              <ChoiceImage src={choice.imageUrl} />
              {/* 피드백 아이콘 */}
              {icon !== null && (
                <span
                  className="absolute right-2 top-2 text-3xl drop-shadow"
                  style={{ zIndex: 3 }}
                  aria-hidden="true"
                >
                  {icon}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
