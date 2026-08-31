import { useEffect, useState } from 'react';
import {
  FAMILY_RELATION_OPTIONS,
  FAMILY_RELATION_LABELS,
  type FamilyMemberInput,
  type FamilyRelation,
  type Gender,
} from '../domain/PatientProfile.js';
import { usePatientProfile } from '../application/usePatientProfile.js';

interface ProfileScreenProps {
  onBack?: () => void;
  /** 뒤로가기 버튼 라벨(설정 허브에서는 "설정"). 기본 "목록으로". */
  backLabel?: string;
  /** true면 자체 뒤로가기 버튼을 숨긴다(상위가 네비게이션을 소유할 때). */
  embedded?: boolean;
}

/**
 * 환자 프로필(가족 페르소나) 편집 화면.
 * - 고향·직업·취미·의미있는 장소·가족 구성원을 등록한다.
 * - 가족 목록은 전체 교체(PUT) 방식으로 저장한다.
 */
export function ProfileScreen({
  onBack,
  backLabel = '목록으로',
  embedded = false,
}: ProfileScreenProps) {
  const { profile, isLoading, isSaving, error, save } = usePatientProfile();

  const [hometown, setHometown] = useState('');
  const [occupation, setOccupation] = useState('');
  const [hobbies, setHobbies] = useState<string[]>([]);
  const [places, setPlaces] = useState<string[]>([]);
  const [family, setFamily] = useState<FamilyMemberInput[]>([]);
  const [saved, setSaved] = useState(false);

  // 로드된 프로필로 폼 초기화
  useEffect(() => {
    if (profile) {
      setHometown(profile.hometown ?? '');
      setOccupation(profile.occupation ?? '');
      setHobbies(profile.hobbies);
      setPlaces(profile.significantPlaces);
      setFamily(
        profile.family.map((m) => ({
          relation: m.relation,
          name: m.name,
          gender: m.gender,
          note: m.note ?? undefined,
        })),
      );
    }
  }, [profile]);

  const handleSave = async () => {
    setSaved(false);
    const ok = await save({
      hometown,
      occupation,
      hobbies,
      significantPlaces: places,
      family: family.filter((f) => f.name.trim().length > 0),
    });
    if (ok) {
      setSaved(true);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center text-sm text-[#5C6661]">
        불러오는 중...
      </div>
    );
  }

  return (
    <div className="font-pretendard mx-auto w-full max-w-lg">
      {!embedded && (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 flex items-center gap-1 text-sm text-[#5C6661] transition-colors hover:text-[#2D6A56]"
          aria-label={`${backLabel}(으)로 돌아가기`}
        >
          ← {backLabel}
        </button>
      )}

      <header className="mb-6">
        <h2 className="text-2xl font-bold text-[#2D6A56]">환자 정보</h2>
        <p className="mt-2 text-sm text-[#5C6661]">
          가족과 추억의 장소를 등록하면, AI가 환자분의 이름·관계를 활용해 더 생생한
          훈련 시나리오를 만들어 드려요. (실명은 안전하게 암호화되며 외부 AI에는
          노출되지 않습니다.)
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-[#C94040]/30 bg-[#C94040]/10 p-3 text-sm text-[#7A2E15]"
        >
          {error}
        </div>
      )}

      {/* 기본 정보 */}
      <section className="mb-4 rounded-xl bg-white p-5">
        <h3 className="mb-3 text-base font-medium text-[#1F2A26]">기본 정보</h3>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-[#5C6661]">고향</span>
          <input
            type="text"
            value={hometown}
            onChange={(e) => setHometown(e.target.value)}
            placeholder="예: 강릉"
            className="w-full rounded-xl border border-[#D4D8D4] bg-[#FBFBFA] p-3 text-sm text-[#1F2A26] focus:border-[#2D6A56] focus:outline-none focus:ring-1 focus:ring-[#2D6A56]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[#5C6661]">직업</span>
          <input
            type="text"
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
            placeholder="예: 교사"
            className="w-full rounded-xl border border-[#D4D8D4] bg-[#FBFBFA] p-3 text-sm text-[#1F2A26] focus:border-[#2D6A56] focus:outline-none focus:ring-1 focus:ring-[#2D6A56]"
          />
        </label>
      </section>

      {/* 취미 */}
      <section className="mb-4 rounded-xl bg-white p-5">
        <h3 className="mb-3 text-base font-medium text-[#1F2A26]">취미</h3>
        <ChipEditor
          items={hobbies}
          onChange={setHobbies}
          placeholder="예: 등산 (입력 후 추가)"
          label="취미 추가"
        />
      </section>

      {/* 의미있는 장소 */}
      <section className="mb-4 rounded-xl bg-white p-5">
        <h3 className="mb-3 text-base font-medium text-[#1F2A26]">
          의미 있는 장소
        </h3>
        <ChipEditor
          items={places}
          onChange={setPlaces}
          placeholder="예: ○○공원 (입력 후 추가)"
          label="의미 있는 장소 추가"
        />
      </section>

      {/* 가족 구성원 */}
      <section className="mb-4 rounded-xl bg-white p-5">
        <h3 className="mb-3 text-base font-medium text-[#1F2A26]">가족 구성원</h3>
        <FamilyEditor family={family} onChange={setFamily} />
      </section>

      {saved && (
        <p
          className="mb-3 text-center text-sm text-[#2D6A56]"
          role="status"
        >
          저장되었습니다.
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={isSaving}
        className="w-full rounded-xl bg-[#2D6A56] px-8 py-3 text-base font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-[#1F5240] disabled:cursor-not-allowed disabled:bg-[#C5C8C5]"
      >
        {isSaving ? '저장 중…' : '저장'}
      </button>
    </div>
  );
}

// ─── 칩 에디터 (취미·장소 공용) ─────────────────────────────────

interface ChipEditorProps {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  /** 스크린리더용 입력 이름. placeholder는 접근 가능한 이름이 아니다. */
  label: string;
}

function ChipEditor({ items, onChange, placeholder, label }: ChipEditorProps) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) {
      onChange([...items, v]);
    }
    setDraft('');
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          aria-label={label}
          className="flex-1 rounded-xl border border-[#D4D8D4] bg-[#FBFBFA] p-3 text-sm text-[#1F2A26] focus:border-[#2D6A56] focus:outline-none focus:ring-1 focus:ring-[#2D6A56]"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-xl bg-[#EBF4F0] px-4 text-sm font-medium text-[#2D6A56] transition-colors hover:bg-[#D9EAE3]"
        >
          추가
        </button>
      </div>
      {items.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 rounded-full bg-[#EBF4F0] px-3 py-1 text-sm text-[#2D6A56]"
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(items.filter((i) => i !== item))}
                className="text-[#5C6661] hover:text-[#B85C36]"
                aria-label={`${item} 삭제`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 가족 에디터 ───────────────────────────────────────────────

interface FamilyEditorProps {
  family: FamilyMemberInput[];
  onChange: (family: FamilyMemberInput[]) => void;
}

function FamilyEditor({ family, onChange }: FamilyEditorProps) {
  const [relation, setRelation] = useState<FamilyRelation>('son');
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender>('U');

  const add = () => {
    const v = name.trim();
    if (!v) return;
    onChange([...family, { relation, name: v, gender }]);
    setName('');
    setGender('U');
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <select
          value={relation}
          onChange={(e) => setRelation(e.target.value as FamilyRelation)}
          className="rounded-xl border border-[#D4D8D4] bg-[#FBFBFA] p-3 text-sm text-[#1F2A26] focus:border-[#2D6A56] focus:outline-none"
          aria-label="관계 선택"
        >
          {FAMILY_RELATION_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {FAMILY_RELATION_LABELS[r]}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="이름 (예: 민준)"
          aria-label="가족 이름"
          className="min-w-[120px] flex-1 rounded-xl border border-[#D4D8D4] bg-[#FBFBFA] p-3 text-sm text-[#1F2A26] focus:border-[#2D6A56] focus:outline-none focus:ring-1 focus:ring-[#2D6A56]"
        />
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value as Gender)}
          className="rounded-xl border border-[#D4D8D4] bg-[#FBFBFA] p-3 text-sm text-[#1F2A26] focus:border-[#2D6A56] focus:outline-none"
          aria-label="성별 선택"
        >
          <option value="U">성별</option>
          <option value="M">남</option>
          <option value="F">여</option>
        </select>
        <button
          type="button"
          onClick={add}
          className="rounded-xl bg-[#EBF4F0] px-4 text-sm font-medium text-[#2D6A56] transition-colors hover:bg-[#D9EAE3]"
        >
          추가
        </button>
      </div>

      {family.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {family.map((m, idx) => (
            <li
              key={`${m.relation}-${m.name}-${idx}`}
              className="flex items-center justify-between rounded-xl bg-[#F7F6F3] px-3 py-2 text-sm"
            >
              <span className="text-[#1F2A26]">
                <span className="font-medium text-[#2D6A56]">
                  {FAMILY_RELATION_LABELS[m.relation]}
                </span>{' '}
                · {m.name}
              </span>
              <button
                type="button"
                onClick={() => onChange(family.filter((_, i) => i !== idx))}
                className="text-xs text-[#5C6661] underline hover:text-[#B85C36]"
                aria-label={`${m.name} 삭제`}
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
