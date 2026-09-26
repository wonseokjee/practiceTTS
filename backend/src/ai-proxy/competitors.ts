/**
 * `/ai/pronunciation`의 경쟁자 모드 입력(이웃 비교 채점) 검증.
 *
 * 프론트가 `competitors`(같은 녹음을 참조로도 채점할 단어의 JSON 배열 문자열)와
 * `stt_competitor`(후보 없는 인식 결과도 경쟁자로 채점할지)를 보낸다. 프록시는 형식과
 * 크기만 지키고 그대로 ai-service에 넘긴다 — 채점·판정은 여기서 하지 않는다.
 *
 * **상한은 ai-service와 같은 값이어야 한다.** 어긋나면 그 사이 구간이 "프록시는 받아주지만
 * ai-service가 반드시 거절하는" 죽은 구간이 된다(`MAX_AUDIO_BYTES`와 같은 종류의 사고).
 * `competitors.spec.ts`가 두 값을 대조한다.
 */

/** ai-service `services/competitor_service.py`의 `MAX_COMPETITORS`. */
export const MAX_COMPETITORS = 5;

/** ai-service `routers/pronunciation.py`의 `MAX_COMPETITOR_LEN`. */
export const MAX_COMPETITOR_LEN = 30;

/**
 * `competitors` 폼 값을 검증해 정리한다.
 *
 * @returns 정리된 단어 목록(안 보냈거나 빈 배열이면 `[]`), 형식·크기가 틀리면 `null`.
 *          공백 항목은 버린다. 개수 상한은 정리 전 원본 기준이다(입력 크기 상한).
 */
export function parseCompetitors(raw: unknown): string[] | null {
  if (raw === undefined || raw === null || raw === '') return [];
  if (typeof raw !== 'string') return null; // 같은 필드를 여러 번 보내면 배열로 온다
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || data.length > MAX_COMPETITORS) return null;
  const out: string[] = [];
  for (const item of data as unknown[]) {
    if (typeof item !== 'string') return null;
    const text = item.trim();
    if (text.length > MAX_COMPETITOR_LEN) return null;
    if (text) out.push(text);
  }
  return out;
}

/**
 * `stt_competitor` 폼 값. 안 보냈으면 false, `'true'`/`'false'`만 받고 그 밖은 `null`.
 * (ai-service는 불리언 폼 값의 다른 표기도 받지만, 프록시는 프론트가 보내는 두 값만 통과시킨다.)
 */
export function parseSttCompetitor(raw: unknown): boolean | null {
  if (raw === undefined || raw === null || raw === '') return false;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}
