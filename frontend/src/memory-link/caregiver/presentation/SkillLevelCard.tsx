// 보호자용 스킬 눈높이(적응 레벨) 카드
//
// 환자별×스킬별 적응 레벨(1~5)을 "지금 어느 눈높이에서 연습 중인지"로 보여준다.
// 설계 확정(plan-design-review): 성적표가 아니라 **방향**이다. 상태색(빨강/초록)·
// "낮다/못한다" 판단을 붙이지 않는다 — 눈높이는 난이도 조절값일 뿐, 등급이 아니다.
// 환자에겐 이 레벨을 노출하지 않는다(강등 비가시). 보호자에게만 담담히 보여준다.

import { useEffect, useState } from 'react';
import { quizApi } from '../../patient/quiz/infrastructure/QuizApi.js';
import type { SkillLevels } from '../../patient/quiz/domain/QabResult.js';

interface SkillLevelCardProps {
  /** 레벨 조회 함수(테스트 주입용). 없으면 quizApi.getSkillLevels. */
  fetchLevels?: () => Promise<SkillLevels>;
}

const MAX_LEVEL = 5;

/** 표시할 난이도 조절 스킬 + 라벨(loc은 진단성이라 눈높이 개념이 없어 제외). */
const LEVELED_SKILLS: Array<{ key: string; label: string }> = [
  { key: 'word', label: '단어 이해' },
  { key: 'sentence', label: '문장 이해' },
  { key: 'naming', label: '그림 이름대기' },
  { key: 'repeat', label: '따라 말하기' },
  { key: 'reading', label: '소리 내어 읽기' },
  { key: 'ddk', label: '말운동(퍼터커)' },
];

type LoadState = 'loading' | 'ready' | 'error';

/** 눈높이 5단계 점 표시(현재 레벨까지 세이지, 나머지 테두리). danger 색 없음. */
function LevelDots({ level, label }: { level: number; label: string }) {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, level));
  return (
    <span
      className="flex items-center gap-1"
      role="img"
      aria-label={`${label} 눈높이 ${clamped}단계 / ${MAX_LEVEL}`}
    >
      {Array.from({ length: MAX_LEVEL }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`h-2.5 w-2.5 rounded-full ${
            i < clamped ? 'bg-[#2D6A56]' : 'border border-[#D8DAD6]'
          }`}
        />
      ))}
    </span>
  );
}

export function SkillLevelCard({ fetchLevels }: SkillLevelCardProps) {
  const [state, setState] = useState<LoadState>('loading');
  const [levels, setLevels] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    const run = fetchLevels ?? quizApi.getSkillLevels;
    run()
      .then((data) => {
        if (!alive) return;
        setLevels(data.levels);
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, [fetchLevels]);

  // 로딩/에러는 카드를 숨긴다(대시보드를 어지럽히지 않음).
  if (state !== 'ready') return null;

  return (
    <section
      className="mb-6 rounded-2xl border border-[#E5E5E0] bg-white p-5"
      aria-label="스킬별 연습 눈높이"
    >
      <h2 className="mb-1 text-base font-bold text-[#1F2A26]">연습 눈높이</h2>
      <p className="mb-4 text-sm text-[#5C6661]">
        스킬마다 지금 어느 난이도에서 연습 중인지예요. 잘하는 만큼 눈높이가
        올라가고, 어려우면 부드럽게 내려가 늘 알맞은 난이도로 맞춰져요.
      </p>

      <ul className="flex flex-col gap-3">
        {LEVELED_SKILLS.map(({ key, label }) => (
          <li key={key} className="flex items-center justify-between">
            <span className="text-sm font-medium text-[#1F2A26]">{label}</span>
            <span className="flex items-center gap-2">
              <LevelDots level={levels[key] ?? 2} label={label} />
              <span className="w-14 text-right text-sm tabular-nums text-[#5C6661]">
                {levels[key] ?? 2}단계
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
