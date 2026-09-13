// QAB 이미지 선택형 문항 렌더러 (kind 'qab')
//
// 들려주는 단어/문장(promptText)을 듣고 그에 맞는 그림을 고른다(QAB wordComp/sentComp 공용).
// 음성은 mp3 대신 TTS(서버 Azure 뉴럴 → Web Speech 폴백)로 발음한다 → 문항 확장이 자유롭다.
// 피드백 단계: 정답 카드 초록 + ✓, 내가 고른 오답 카드 빨강 + ✗.
//
// 로딩 중에는 그림의 정답(라벨)을 절대 노출하지 않는다 — 중립 로딩/에러 표시만 사용.
// 소리가 끝내 안 나면(서버·브라우저 음성 둘 다 실패) 듣기 버튼 위에 안내를 띄운다.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTTS } from '../../../../../shared/hooks/useTTS.js';
import { createTtsService } from '../../../../../shared/infrastructure/ttsFactory.js';
import type { QabImageItem } from '../../domain/MixedQuiz.js';
import { TtsFailureNotice } from './TtsFailureNotice.js';

/**
 * 선택지 그림 — 로딩/실패 상태를 자체 관리한다.
 * 로딩 전까지 이미지를 투명 처리하고, 라벨이 아닌 중립 표시만 보여 정답 노출을 막는다.
 */
function ChoiceImage({ src }: { src: string }) {
  const { t } = useTranslation('quiz');
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    'loading',
  );
  return (
    <>
      {status !== 'loaded' && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-surface-dim text-muted-faint"
          aria-hidden="true"
          style={{ zIndex: 0 }}
        >
          {status === 'loading' ? (
            <span className="animate-pulse text-3xl">🖼️</span>
          ) : (
            <>
              <span className="text-2xl">🖼️</span>
              <span className="text-xs">{t('imageChoice.imageError')}</span>
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
  /**
   * 선택지를 골랐다.
   *
   * `unheard`는 **소리가 안 난 상태로 골랐다**는 뜻이다. 듣기가 이 문항의
   * 전부라, 그때의 정오답은 이해력이 아니라 찍기다. 검사 쪽은 이 값으로
   * 문항을 채점에서 뺀다(`unscored`). 연습은 안 써도 된다.
   */
  onSelect: (choiceId: string, ctx: { unheard: boolean }) => void;
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
  const { t } = useTranslation('quiz');
  const ttsService = useMemo(() => createTtsService(), []);
  const { isPlaying, error: ttsError, speak } = useTTS(ttsService);

  // 문항 진입 시 1회 자동 발음 (브라우저 정책상 막히면 버튼으로 재생).
  const autoPlayedRef = useRef(false);
  useEffect(() => {
    if (autoPlayedRef.current) return;
    autoPlayedRef.current = true;
    void speak(item.promptText);
  }, [speak, item.promptText]);

  const listenLabel =
    item.category === 'sentence'
      ? t('imageChoice.listenSentence')
      : t('imageChoice.listenWord');

  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-muted-sage">{item.instruction}</p>

      {/* 소리가 안 났으면 알린다 — 듣기가 이 문항의 전부다. */}
      {ttsError !== null && <TtsFailureNotice />}

      <button
        type="button"
        onClick={() => void speak(item.promptText)}
        disabled={isPlaying}
        className="flex min-h-[56px] items-center justify-center gap-2 rounded-md bg-white px-5 py-3 text-lg font-medium text-primary ring-1 ring-inset ring-primary transition-colors duration-[180ms] ease-out hover:bg-primary-light disabled:cursor-not-allowed disabled:text-muted-faint disabled:ring-disabled-surface"
        aria-label={t('imageChoice.listenAgainAria', { label: listenLabel })}
      >
        <span aria-hidden="true" className="text-2xl">🔊</span>
        {isPlaying ? t('item.playing') : listenLabel}
      </button>

      <div
        className="grid grid-cols-2 gap-3"
        role="group"
        aria-label={t('imageChoice.groupAria')}
      >
        {item.choices.map((choice) => {
          const isChosen = selectedChoiceId === choice.choiceId;

          // 피드백 단계 강조: 정답=초록, 내가 고른 오답=빨강.
          let ring = 'border-line-soft';
          let icon: string | null = null;
          if (showFeedback && answerOnly) {
            // 연습: 정답만 알려준다. ✗도 빨강도 없다.
            ring = choice.isCorrect
              ? 'border-primary'
              : 'border-line-soft opacity-50';
          } else if (showFeedback) {
            if (choice.isCorrect) {
              ring = 'border-primary';
              icon = '✓';
            } else if (isChosen) {
              ring = 'border-accent-strong';
              icon = '✗';
            } else {
              ring = 'border-line-soft opacity-60';
            }
          } else if (isChosen) {
            ring = 'border-primary';
          }

          return (
            <button
              key={choice.choiceId}
              type="button"
              disabled={!isSelectable}
              onClick={() => {
                // `speak()`가 재생을 시작할 때 error를 비운다. 그래서 이 값이
                // 남아 있다는 건 **마지막 재생이 실패했다**는 뜻이다 — 다시
                // 듣기를 눌러 성공하면 저절로 풀린다.
                if (isSelectable) {
                  onSelect(choice.choiceId, { unheard: ttsError !== null });
                }
              }}
              aria-label={t('imageChoice.choiceAria', { label: choice.label })}
              className={`relative aspect-square w-full overflow-hidden rounded-2xl border-4 transition-all duration-150 disabled:cursor-default ${ring} ${
                isSelectable ? 'hover:border-muted-faint active:scale-[0.97]' : ''
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
