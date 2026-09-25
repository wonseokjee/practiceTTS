import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FAMILY_RELATION_OPTIONS,
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
  backLabel,
  embedded = false,
}: ProfileScreenProps) {
  const { t } = useTranslation('caregiver');
  const label = backLabel ?? t('nav.listLabel');
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
      <div className="flex min-h-[300px] items-center justify-center text-sm text-muted-sage">
        {t('weeklyReport.loading')}
      </div>
    );
  }

  return (
    <div className="font-pretendard mx-auto w-full max-w-lg">
      {!embedded && (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 flex items-center gap-1 text-sm text-muted-sage transition-colors hover:text-primary"
          aria-label={t('nav.backAria', { label })}
        >
          ← {label}
        </button>
      )}

      <header className="mb-6">
        <h2 className="text-2xl font-bold text-primary">{t('settings.patientInfoTitle')}</h2>
        <p className="mt-2 text-sm text-muted-sage">
          {t('profile.subtitle')}
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-accent-ink"
        >
          {error}
        </div>
      )}

      {/* 기본 정보 */}
      <section className="mb-4 rounded-xl bg-white p-5">
        <h3 className="mb-3 text-base font-medium text-ink-sage">{t('profile.basicInfoTitle')}</h3>
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-muted-sage">{t('profile.hometownLabel')}</span>
          <input
            type="text"
            value={hometown}
            onChange={(e) => setHometown(e.target.value)}
            placeholder={t('profile.hometownPlaceholder')}
            className="w-full rounded-xl border border-line-strong bg-surface-soft p-3 text-sm text-ink-sage focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-sage">{t('profile.occupationLabel')}</span>
          <input
            type="text"
            value={occupation}
            onChange={(e) => setOccupation(e.target.value)}
            placeholder={t('profile.occupationPlaceholder')}
            className="w-full rounded-xl border border-line-strong bg-surface-soft p-3 text-sm text-ink-sage focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
      </section>

      {/* 취미 */}
      <section className="mb-4 rounded-xl bg-white p-5">
        <h3 className="mb-3 text-base font-medium text-ink-sage">{t('profile.hobbiesTitle')}</h3>
        <ChipEditor
          items={hobbies}
          onChange={setHobbies}
          placeholder={t('profile.hobbiesPlaceholder')}
          label={t('profile.hobbiesAddLabel')}
        />
      </section>

      {/* 의미있는 장소 */}
      <section className="mb-4 rounded-xl bg-white p-5">
        <h3 className="mb-3 text-base font-medium text-ink-sage">
          {t('profile.placesTitle')}
        </h3>
        <ChipEditor
          items={places}
          onChange={setPlaces}
          placeholder={t('profile.placesPlaceholder')}
          label={t('profile.placesAddLabel')}
        />
      </section>

      {/* 가족 구성원 */}
      <section className="mb-4 rounded-xl bg-white p-5">
        <h3 className="mb-3 text-base font-medium text-ink-sage">{t('profile.familyTitle')}</h3>
        <FamilyEditor family={family} onChange={setFamily} />
      </section>

      {saved && (
        <p
          className="mb-3 text-center text-sm text-primary"
          role="status"
        >
          {t('profile.saved')}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={isSaving}
        className="w-full rounded-xl bg-primary px-8 py-3 text-base font-medium text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark disabled:cursor-not-allowed disabled:bg-disabled-surface"
      >
        {isSaving ? t('profile.saving') : t('profile.save')}
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
  const { t } = useTranslation('caregiver');
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
          className="flex-1 rounded-xl border border-line-strong bg-surface-soft p-3 text-sm text-ink-sage focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-xl bg-primary-light px-4 text-sm font-medium text-primary transition-colors hover:bg-[#D9EAE3]"
        >
          {t('profile.add')}
        </button>
      </div>
      {items.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 rounded-full bg-primary-light px-3 py-1 text-sm text-primary"
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(items.filter((i) => i !== item))}
                className="text-muted-sage hover:text-accent-strong"
                aria-label={t('profile.removeItemAria', { item })}
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
  const { t } = useTranslation('caregiver');
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
          className="rounded-xl border border-line-strong bg-surface-soft p-3 text-sm text-ink-sage focus:border-primary focus:outline-none"
          aria-label={t('profile.relationSelectAria')}
        >
          {FAMILY_RELATION_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {t(`profile.relation.${r}`)}
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
          placeholder={t('profile.familyNamePlaceholder')}
          aria-label={t('profile.familyNameAria')}
          className="min-w-[120px] flex-1 rounded-xl border border-line-strong bg-surface-soft p-3 text-sm text-ink-sage focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value as Gender)}
          className="rounded-xl border border-line-strong bg-surface-soft p-3 text-sm text-ink-sage focus:border-primary focus:outline-none"
          aria-label={t('profile.genderSelectAria')}
        >
          <option value="U">{t('profile.genderPlaceholderOption')}</option>
          <option value="M">{t('profile.genderMale')}</option>
          <option value="F">{t('profile.genderFemale')}</option>
        </select>
        <button
          type="button"
          onClick={add}
          className="rounded-xl bg-primary-light px-4 text-sm font-medium text-primary transition-colors hover:bg-[#D9EAE3]"
        >
          {t('profile.add')}
        </button>
      </div>

      {family.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {family.map((m, idx) => (
            <li
              key={`${m.relation}-${m.name}-${idx}`}
              className="flex items-center justify-between rounded-xl bg-canvas px-3 py-2 text-sm"
            >
              <span className="text-ink-sage">
                <span className="font-medium text-primary">
                  {t(`profile.relation.${m.relation}`)}
                </span>{' '}
                · {m.name}
              </span>
              <button
                type="button"
                onClick={() => onChange(family.filter((_, i) => i !== idx))}
                className="text-xs text-muted-sage underline hover:text-accent-strong"
                aria-label={t('profile.removeItemAria', { item: m.name })}
              >
                {t('profile.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
