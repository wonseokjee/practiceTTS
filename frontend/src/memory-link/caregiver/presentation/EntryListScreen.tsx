import type { MemoryEntry } from '../domain/MemoryEntry.js';
import { EMOTION_TAG_LABELS } from '../domain/MemoryEntry.js';
import type { UseMemoryEntriesReturn } from '../application/useMemoryEntries.js';
import { AuthedImage } from '../../shared/AuthedImage.js';
import { isConversationModeEnabled } from '../../shared/featureFlags.js';

interface EntryListScreenProps {
  memoryEntries: UseMemoryEntriesReturn;
  onSelectEntry: (id: string) => void;
}

/**
 * 메모리 엔트리 목록 화면
 * - 카드 형태로 엔트리 목록 표시
 * - 비즈니스 로직 없음 (useMemoryEntries 훅에 위임)
 * - 기억 추가는 상위(CaregiverDashboard) 히어로 버튼이 담당한다.
 */
export function EntryListScreen({
  memoryEntries,
  onSelectEntry,
}: EntryListScreenProps) {
  const { entries, isLoading, error, refresh } = memoryEntries;

  if (isLoading) {
    return (
      <div
        className="flex justify-center items-center min-h-[200px]"
        aria-label="로딩 중"
        aria-live="polite"
      >
        <div className="text-muted-sage text-sm">불러오는 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="p-4 bg-danger/10 border border-danger/30 rounded-2xl text-accent-ink text-sm"
      >
        <p className="font-medium mb-2">목록을 불러오는 데 실패했습니다</p>
        <p className="text-danger mb-3">{error}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-sm text-danger underline hover:text-accent-ink"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* 헤더 영역 */}
      <h2 className="mb-4 text-base font-bold text-ink-sage">기억 목록</h2>

      {/* 빈 상태 */}
      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl text-line-strong mb-4" aria-hidden="true">
            📷
          </div>
          <p className="text-muted-sage mb-2">등록된 기억이 없습니다</p>
          <p className="text-sm text-muted-sage">
            사진과 함께 소중한 기억을 추가해보세요
          </p>
        </div>
      ) : (
        <ul
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          aria-label="메모리 엔트리 목록"
        >
          {entries.map((entry) => (
            <li key={entry.id}>
              <MemoryEntryCard
                entry={entry}
                onClick={() => onSelectEntry(entry.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── 메모리 엔트리 카드 ────────────────────────────────────────

interface MemoryEntryCardProps {
  entry: MemoryEntry;
  onClick: () => void;
}

function MemoryEntryCard({ entry, onClick }: MemoryEntryCardProps) {
  const dateLabel = new Date(entry.createdAt).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // 여러 개면 먼저 적은 것을 쓴다(`orderIndex` 오름차순은 서버가 보장한다).
  const moment = entry.patientNotes.find((n) => n.category === 'moment')
    ?.answerText;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-line overflow-hidden hover:border-primary hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-primary"
      aria-label={`${dateLabel} 메모리 엔트리 상세 보기`}
    >
      {/* 사진 영역 — **없으면 아무것도 그리지 않는다.**
          예전에는 회색 상자에 📷를 띄웠다. 기억은 사진 아니면 글 중 하나가
          반드시 있으므로(백엔드가 `patientAnswers >= 1 OR photo`로 강제한다)
          글만 있는 기억은 결핍이 아니라 **다른 종류의 기억**이다. 환자용
          돌아보기(WeekReviewScreen)가 이미 그렇게 조판한다. */}
      {entry.photoUrl && (
        <AuthedImage
          src={entry.photoUrl}
          alt={`${dateLabel} 기억 사진`}
          className="w-full h-40 object-cover"
          lazy
        />
      )}

      {/* 정보 영역 */}
      <div className="p-3">
        {/* 날짜 */}
        <p className="text-xs text-muted-sage mb-2">{dateLabel}</p>

        {/* 그날의 기억 — 카드의 본문.
            `moment`가 실제 기억이고 `activity`·`context`는 한두 낱말짜리
            태그다(WeekReviewScreen과 같은 구분). 상자를 지우기만 하면 사진
            없는 카드가 날짜만 남으므로, 이미 응답에 들어 있던 글을 여기 쓴다.
            2열 그리드라 좁아서 두 줄로 자른다. */}
        {moment && (
          <p className="mb-2 line-clamp-2 text-sm leading-relaxed text-ink">
            {moment}
          </p>
        )}

        {/* 장소 — 본문이 생겼으니 굵기를 뺀다. 남겨 두면 한두 낱말짜리 태그가
            기억 본문보다 크게 읽힌다. */}
        {entry.locationTag && (
          <p className="mb-1 text-sm text-muted-sage">{entry.locationTag}</p>
        )}

        {/* 감정 태그 */}
        {entry.emotionTag && (
          <span className="inline-block px-2 py-0.5 bg-primary-light text-primary rounded-full text-xs font-medium">
            {EMOTION_TAG_LABELS[entry.emotionTag]}
          </span>
        )}

        {/* 목표 단어 */}
        {entry.targetWords.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {entry.targetWords.map((word) => (
              <span
                key={word}
                className="px-2 py-0.5 bg-surface-dim text-muted-sage rounded-full text-xs"
              >
                {word}
              </span>
            ))}
          </div>
        )}

        {/* 진행 상태 — 환자가 대화를 시작할 수 있는지를 기준으로 표시한다.
            예전에는 '분석 완료'(초록)만 떠서 보호자가 다 끝났다고 판단했는데,
            환자 화면은 '보호자가 준비 중이에요'를 보여줬다. 양쪽이 서로를
            기다리며 아무도 다음 단계를 밟지 않는 교착이 생겼다. */}
        <div className="mt-2">
          <TrainingReadiness entry={entry} />
        </div>
      </div>
    </button>
  );
}

/**
 * 이 기억으로 환자가 대화를 시작할 수 있는지 한 줄로 알린다.
 *
 * 대화(훈련)가 열리려면 보호자가 두 단계를 더 밟아야 한다:
 *   1. 훈련 목표 단어 등록 (1~3개)
 *   2. 훈련 시나리오 생성
 *
 * 이걸 안내하지 않아서 실제로 교착이 생겼다. 보호자는 '분석 완료' 배지를 보고
 * 끝났다고 판단했고, 환자 화면은 '보호자가 준비 중이에요'를 띄웠다. 서로를
 * 기다리며 아무도 다음 단계를 밟지 않았다.
 *
 * 그래서 완료 표시가 아니라 **다음에 할 일**을 보여준다.
 */
function TrainingReadiness({ entry }: { entry: MemoryEntry }) {
  // 대화를 감춘 상태라면 준비 안내 자체가 의미 없다. 환자가 쓸 수 없는
  // 기능을 두고 "대화하려면 …해 주세요"라고 하면 헛수고를 시킨다.
  if (!isConversationModeEnabled()) {
    return null;
  }

  // 준비 완료 — 환자가 지금 바로 대화를 시작할 수 있다.
  if (entry.hasScenario) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-light text-primary rounded-full text-xs font-medium">
        대화 준비 완료
      </span>
    );
  }

  // 사진·기록 분석이 아직이면 보호자가 할 수 있는 일이 없다. 기다리면 된다.
  if (!entry.hasMaskedContext) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-dim text-muted-sage rounded-full text-xs">
        분석 중
      </span>
    );
  }

  // 여기서부터가 보호자의 차례다. 무엇을 해야 하는지 구체적으로 말한다.
  const nextStep =
    entry.targetWords.length === 0
      ? '목표 단어를 등록해 주세요'
      : '시나리오를 생성해 주세요';

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/15 text-[#b5602f] rounded-full text-xs font-medium">
      대화하려면 {nextStep}
    </span>
  );
}
