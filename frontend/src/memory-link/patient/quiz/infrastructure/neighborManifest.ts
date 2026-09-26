// 이름대기 이웃 목록 접근자 — 이웃 비교 채점이 목표 낱말마다 함께 채점할 이웃 단어.
//
// 목록은 `scripts/build_neighbor_manifest.py`가 만든 정적 자산이다(계획 PR 1). 실측이 쓴
// `neighbor_manifest.py`의 `neighbors()`와 같은 함수로 만들어, 실측한 것과 앱이 쓰는 것이 같다.
// 낱말을 풀에 더하고 목록을 다시 안 만들면 그 낱말은 여기서 null이 되어 이전 채점으로 떨어진다 —
// `neighborManifest.test.ts`가 그 사고를 막는다.

import manifest from '../../../../assets/data/neighborManifest.ko-KR.json';

const NEIGHBORS = manifest.neighbors as Record<string, string[]>;

/**
 * 이 낱말의 이웃 단어. 이웃 비교를 쓸 수 없으면 null이다.
 *
 * - 목록의 로케일(ko-KR)과 다르면 null — 영어는 이 채점이 검증되지 않았다(설계 10절).
 * - 목록에 없는 낱말이면 null — 호출한 쪽이 이전 채점으로 간다.
 */
export function neighborsFor(
  word: string,
  locale: string,
): readonly string[] | null {
  if (locale !== manifest.locale) return null;
  // 객체를 그냥 조회하면 'constructor'·'toString' 같은 상속 속성이 걸려 배열이 아닌 것을 돌려준다.
  if (!Object.prototype.hasOwnProperty.call(NEIGHBORS, word)) return null;
  const neighbors = NEIGHBORS[word];
  return neighbors.length > 0 ? neighbors : null;
}
