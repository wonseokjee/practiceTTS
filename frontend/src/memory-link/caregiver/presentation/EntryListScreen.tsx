import type { MemoryEntry } from '../domain/MemoryEntry.js';
import { EMOTION_TAG_LABELS } from '../domain/MemoryEntry.js';
import type { UseMemoryEntriesReturn } from '../application/useMemoryEntries.js';

interface EntryListScreenProps {
  memoryEntries: UseMemoryEntriesReturn;
  onSelectEntry: (id: string) => void;
  onAddNew: () => void;
}

/**
 * 메모리 엔트리 목록 화면
 * - 카드 형태로 엔트리 목록 표시
 * - 비즈니스 로직 없음 (useMemoryEntries 훅에 위임)
 */
export function EntryListScreen({
  memoryEntries,
  onSelectEntry,
  onAddNew,
}: EntryListScreenProps) {
  const { entries, isLoading, error, refresh } = memoryEntries;

  if (isLoading) {
    return (
      <div
        className="flex justify-center items-center min-h-[200px]"
        aria-label="로딩 중"
        aria-live="polite"
      >
        <div className="text-gray-400 text-sm">불러오는 중...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm"
      >
        <p className="font-medium mb-2">목록을 불러오는 데 실패했습니다</p>
        <p className="text-red-500 mb-3">{error}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="text-sm text-red-600 underline hover:text-red-800"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* 헤더 영역 */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-gray-900">기억 목록</h2>
        <button
          type="button"
          onClick={onAddNew}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          aria-label="새 기억 추가"
        >
          + 새 기억
        </button>
      </div>

      {/* 빈 상태 */}
      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-5xl text-gray-200 mb-4" aria-hidden="true">
            📷
          </div>
          <p className="text-gray-500 mb-2">등록된 기억이 없습니다</p>
          <p className="text-sm text-gray-400">
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
      className="w-full text-left bg-white rounded-xl border border-gray-200 overflow-hidden hover:border-blue-300 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-400"
      aria-label={`${dateLabel} 메모리 엔트리 상세 보기`}
    >
      {/* 사진 영역 */}
      {entry.photoUrl ? (
        <img
          src={entry.photoUrl}
          alt={`${dateLabel} 기억 사진`}
          className="w-full h-40 object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-40 bg-gray-100 flex items-center justify-center">
          <span className="text-3xl text-gray-300" aria-hidden="true">📷</span>
        </div>
      )}

      {/* 정보 영역 */}
      <div className="p-3">
        {/* 날짜 */}
        <p className="text-xs text-gray-400 mb-2">{dateLabel}</p>

        {/* 장소 및 사물 태그 */}
        {entry.locationTag && (
          <p className="text-sm font-medium text-gray-700 mb-1">
            {entry.locationTag}
          </p>
        )}

        {/* 감정 태그 */}
        {entry.emotionTag && (
          <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs font-medium">
            {EMOTION_TAG_LABELS[entry.emotionTag]}
          </span>
        )}

        {/* 목표 단어 */}
        {entry.targetWords.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {entry.targetWords.map((word) => (
              <span
                key={word}
                className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
              >
                {word}
              </span>
            ))}
          </div>
        )}

        {/* 상태 배지 */}
        <div className="mt-2 flex gap-1">
          {entry.hasMaskedContext && (
            <span className="px-1.5 py-0.5 bg-green-50 text-green-600 rounded text-xs">
              분석 완료
            </span>
          )}
          {entry.hasScenario && (
            <span className="px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded text-xs">
              시나리오 준비
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
