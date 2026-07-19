import type { MemoryEntry } from '../domain/MemoryEntry.js';
import { EMOTION_TAG_LABELS } from '../domain/MemoryEntry.js';
import type { UseMemoryEntriesReturn } from '../application/useMemoryEntries.js';
import { resolveMediaUrl } from '../../shared/MemoryLinkApi.js';

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
        <div className="text-[#9AA09B] text-sm">불러오는 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="p-4 bg-[#C94040]/10 border border-[#C94040]/30 rounded-2xl text-[#7A2E15] text-sm"
      >
        <p className="font-medium mb-2">목록을 불러오는 데 실패했습니다</p>
        <p className="text-[#C94040] mb-3">{error}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-sm text-[#C94040] underline hover:text-[#7A2E15]"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* 헤더 영역 */}
      <h2 className="text-lg font-bold text-[#1A1916] mb-4">기억 목록</h2>

      {/* 빈 상태 */}
      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl text-[#D4D8D4] mb-4" aria-hidden="true">
            📷
          </div>
          <p className="text-[#6B6560] mb-2">등록된 기억이 없습니다</p>
          <p className="text-sm text-[#9AA09B]">
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

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-white rounded-2xl border border-[#E8E4DC] overflow-hidden hover:border-[#2D6A56] hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#2D6A56]"
      aria-label={`${dateLabel} 메모리 엔트리 상세 보기`}
    >
      {/* 사진 영역 */}
      {entry.photoUrl ? (
        <img
          src={resolveMediaUrl(entry.photoUrl)}
          alt={`${dateLabel} 기억 사진`}
          className="w-full h-40 object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-40 bg-[#EBF4F0]/50 flex items-center justify-center">
          <span className="text-3xl text-[#9AA09B]" aria-hidden="true">📷</span>
        </div>
      )}

      {/* 정보 영역 */}
      <div className="p-3">
        {/* 날짜 */}
        <p className="text-xs text-[#9AA09B] mb-2">{dateLabel}</p>

        {/* 장소 및 사물 태그 */}
        {entry.locationTag && (
          <p className="text-sm font-medium text-[#1A1916] mb-1">
            {entry.locationTag}
          </p>
        )}

        {/* 감정 태그 */}
        {entry.emotionTag && (
          <span className="inline-block px-2 py-0.5 bg-[#EBF4F0] text-[#2D6A56] rounded-full text-xs font-medium">
            {EMOTION_TAG_LABELS[entry.emotionTag]}
          </span>
        )}

        {/* 목표 단어 */}
        {entry.targetWords.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {entry.targetWords.map((word) => (
              <span
                key={word}
                className="px-2 py-0.5 bg-[#F2F1EC] text-[#6B6560] rounded-full text-xs"
              >
                {word}
              </span>
            ))}
          </div>
        )}

        {/* 상태 배지 */}
        <div className="mt-2 flex gap-1">
          {entry.hasMaskedContext && (
            <span className="px-1.5 py-0.5 bg-[#EBF4F0] text-[#2D6A56] rounded-full text-xs">
              분석 완료
            </span>
          )}
          {entry.hasScenario && (
            <span className="px-1.5 py-0.5 bg-[#E07B54]/15 text-[#b5602f] rounded-full text-xs">
              시나리오 준비
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
