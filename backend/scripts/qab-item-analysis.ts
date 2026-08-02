/**
 * QAB 문항 분석 (item analysis) — 저장된 qab_results로 문항 타당성을 데이터로 검증한다.
 *
 * 문항별 정답률을 집계해, 검토가 필요한 문항을 자동 플래그한다:
 *   - insufficient : 표본 부족(고유 환자 < MIN_N) — 통계적으로 판단 불가(더 모아야 함)
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
  patients: string; // 고유 환자 수 (pg COUNT → string)
  attempts: string; // 총 시도 수
  correct_rate: string | null; // 환자별 정답률의 평균(시도 가중 아님)
  avg_score: string | null; // 환자별 평균 점수의 평균
}

const CHANCE: Record<string, number> = { word: 0.25, sentence: 0.5 };

function flagsFor(
  subtest: string,
  patients: number,
  rate: number,
  minN: number,
): string[] {
  // 표본 부족 판정은 '고유 환자 수' 기준. 한 환자가 같은 문항을 여러 번 풀어도
  // 통계적 독립 표본이 늘어나는 게 아니므로 시도 수가 아닌 환자 수로 센다.
  if (patients < minN) return ['insufficient'];
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
    // 환자별로 먼저 집계(정답률·평균점수)한 뒤, 그 값들을 문항 단위로 평균낸다.
    // 이렇게 하면 한 환자가 반복 응답해도 문항 통계를 좌우하지 못한다(환자 1인 1표).
    const rows: Row[] = await AppDataSource.query(`
      SELECT subtest,
             item_ref,
             COUNT(*)              AS patients,
             SUM(attempts)         AS attempts,
             AVG(patient_rate)     AS correct_rate,
             AVG(patient_score)    AS avg_score
      FROM (
        SELECT subtest,
               item_ref,
               patient_id,
               COUNT(*)                AS attempts,
               AVG((is_correct)::int)  AS patient_rate,
               AVG(score)              AS patient_score
        FROM qab_results
        WHERE assisted = false
        GROUP BY subtest, item_ref, patient_id
      ) per_patient
      GROUP BY subtest, item_ref
    `);

    if (rows.length === 0) {
      console.log(
        '분석할 응답이 없습니다(qab_results 비어있음). 실제 사용이 쌓이면 다시 실행하세요.',
      );
      return;
    }

    const analyzed = rows.map((r) => {
      const patients = Number(r.patients);
      const attempts = Number(r.attempts);
      const rate = r.correct_rate !== null ? Number(r.correct_rate) : 0;
      const flags = flagsFor(r.subtest, patients, rate, minN);
      return {
        subtest: r.subtest,
        item_ref: r.item_ref,
        patients,
        attempts,
        rate,
        avgScore: r.avg_score !== null ? Number(r.avg_score) : null,
        flags,
        sev: Math.min(...flags.map((f) => SEVERITY[f] ?? 9)),
      };
    });

    analyzed.sort((a, b) => a.sev - b.sev || a.rate - b.rate);

    const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
    console.log(`\nQAB 문항 분석 (min-n=${minN} 환자, assisted 제외, 환자별 평균)\n`);
    console.log(
      ['subtest', 'item_ref', '환자', '시도', '정답률', 'avg점수', 'flags'].join(
        '\t',
      ),
    );
    console.log('-'.repeat(78));
    for (const a of analyzed) {
      console.log(
        [
          a.subtest,
          a.item_ref,
          a.patients,
          a.attempts,
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
