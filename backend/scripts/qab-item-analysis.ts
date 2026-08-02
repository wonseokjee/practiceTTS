/**
 * QAB 문항 분석 (item analysis) — 저장된 qab_results로 문항 타당성을 데이터로 검증한다.
 *
 * 문항별 정답률을 집계해, 검토가 필요한 문항을 자동 플래그한다:
 *   - insufficient : 표본 부족(n < MIN_N) — 통계적으로 판단 불가(그냥 더 모아야 함)
 *   - too_easy     : 정답률 ≥ 0.95 — 변별력 없음(너무 쉬움)
 *   - suspect_miskey: 정답률 ≤ 0.10 — 오답키(정답 잘못 지정) 의심 또는 과도하게 어려움
 *   - near_chance  : 선택형에서 정답률이 우연 수준 — 유인지가 나빠 찍기와 구분 안 됨
 *                    (word=4지선다 chance 0.25, sentence=2지선다 chance 0.5)
 *   - ok           : 위에 해당 없음
 *
 * '넘어가기'(assisted=true) 문항은 정확도 집계에서 제외한다(도움받음).
 *
 * 실행:
 *   cd backend && npx ts-node scripts/qab-item-analysis.ts [--min-n=10]
 * (DB 접속은 src/database/data-source.ts 의 env를 그대로 사용)
 */
import AppDataSource from '../src/database/data-source';

interface Row {
  subtest: string;
  item_ref: string;
  n: string; // pg COUNT → string
  correct: string; // SUM(is_correct::int) → string
  avg_score: string | null;
}

const CHANCE: Record<string, number> = { word: 0.25, sentence: 0.5 };

function flagsFor(
  subtest: string,
  n: number,
  rate: number,
  minN: number,
): string[] {
  if (n < minN) return ['insufficient'];
  const flags: string[] = [];
  if (rate >= 0.95) flags.push('too_easy');
  if (rate <= 0.1) flags.push('suspect_miskey');
  const chance = CHANCE[subtest];
  if (chance !== undefined && Math.abs(rate - chance) < 0.1) {
    flags.push('near_chance');
  }
  return flags.length > 0 ? flags : ['ok'];
}

// 검토 우선순위(심각도) — 정렬용. 낮을수록 먼저 보여준다.
const SEVERITY: Record<string, number> = {
  suspect_miskey: 0,
  near_chance: 1,
  too_easy: 2,
  insufficient: 3,
  ok: 4,
};

async function main(): Promise<void> {
  const minNArg = process.argv.find((a) => a.startsWith('--min-n='));
  const minN = minNArg ? Number(minNArg.split('=')[1]) : 10;

  await AppDataSource.initialize();
  try {
    const rows: Row[] = await AppDataSource.query(`
      SELECT subtest,
             item_ref,
             COUNT(*)                              AS n,
             SUM((is_correct)::int)                AS correct,
             AVG(score)                            AS avg_score
      FROM qab_results
      WHERE assisted = false
      GROUP BY subtest, item_ref
    `);

    if (rows.length === 0) {
      console.log(
        '분석할 응답이 없습니다(qab_results 비어있음). 실제 사용이 쌓이면 다시 실행하세요.',
      );
      return;
    }

    const analyzed = rows.map((r) => {
      const n = Number(r.n);
      const correct = Number(r.correct);
      const rate = n > 0 ? correct / n : 0;
      const flags = flagsFor(r.subtest, n, rate, minN);
      return {
        subtest: r.subtest,
        item_ref: r.item_ref,
        n,
        rate,
        avgScore: r.avg_score !== null ? Number(r.avg_score) : null,
        flags,
        sev: Math.min(...flags.map((f) => SEVERITY[f] ?? 9)),
      };
    });

    analyzed.sort((a, b) => a.sev - b.sev || a.rate - b.rate);

    const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
    console.log(`\nQAB 문항 분석 (min-n=${minN}, assisted 제외)\n`);
    console.log(
      ['subtest', 'item_ref', 'n', '정답률', 'avg점수', 'flags'].join('\t'),
    );
    console.log('-'.repeat(72));
    for (const a of analyzed) {
      console.log(
        [
          a.subtest,
          a.item_ref,
          a.n,
          pct(a.rate),
          a.avgScore !== null ? a.avgScore.toFixed(0) : '-',
          a.flags.join(','),
        ].join('\t'),
      );
    }

    // 요약
    const counts: Record<string, number> = {};
    for (const a of analyzed) {
      for (const f of a.flags) counts[f] = (counts[f] ?? 0) + 1;
    }
    console.log('\n요약:', JSON.stringify(counts));
    const attention = analyzed.filter((a) =>
      a.flags.some((f) => f === 'suspect_miskey' || f === 'near_chance'),
    );
    if (attention.length > 0) {
      console.log(
        `\n⚠ 우선 검토 ${attention.length}개(오답키 의심/우연 수준): `,
        attention.map((a) => `${a.subtest}:${a.item_ref}`).join(', '),
      );
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('분석 실패:', err);
  process.exit(1);
});
