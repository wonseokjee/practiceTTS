// 따라말하기(검사6)·소리 내어 읽기(검사7) 로컬 채점 — STT 인식 텍스트와 목표 텍스트의 오류율.
//
// 단어는 음절(글자) 단위, 문장은 어절(공백) 단위 편집거리로 오류율(WER)을 구한다.
// 실어증 + 브라우저 STT 특성상 관대하게 보며, 오류율이 임계값 이하이면 정답으로 본다.
//
// 단어(word) 모드는 음소 유사 가중 편집거리(phoneticEditDistance)를 써서, 구음장애·
// 노인 발화의 조음 유사 혼동(ㅂ↔ㅍ, 종성 탈락 등)을 부분 오류로 관대하게 본다.
// 문장(sentence) 모드는 어절 단위라 음소 거리가 부적합해 표준 편집거리를 유지한다.

import { phoneticEditDistance } from './phoneticDistance.js';

/** 비교용 정규화: NFC + 소문자 + 구두점 제거 + 공백 정리. */
function normalize(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.,!?~…·"'""''「」『』]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 토큰 배열 간 Levenshtein 편집거리. */
function editDistance(a: readonly string[], b: readonly string[]): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // 삭제
        curr[j - 1] + 1, // 삽입
        prev[j - 1] + cost, // 치환
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** 'word'=음절 단위, 'sentence'=어절 단위로 토큰화. */
function tokenize(text: string, mode: 'word' | 'sentence'): string[] {
  const norm = normalize(text);
  if (norm.length === 0) return [];
  return mode === 'sentence'
    ? norm.split(' ').filter((t) => t.length > 0)
    : [...norm.replace(/\s+/g, '')];
}

/**
 * 오류율(WER) — 편집거리 / 목표 토큰 수. 목표가 비면 1(완전 오류)로 본다.
 * 0이면 완전 일치, 값이 클수록 많이 틀림.
 */
export function speechErrorRate(
  transcript: string,
  target: string,
  mode: 'word' | 'sentence',
): number {
  const said = tokenize(transcript, mode);
  const want = tokenize(target, mode);
  if (want.length === 0) return said.length === 0 ? 0 : 1;
  // 단어는 음소 유사 가중 거리(조음 유사 혼동에 관대), 문장은 어절 표준 거리.
  const distance =
    mode === 'word'
      ? phoneticEditDistance(said, want)
      : editDistance(said, want);
  return distance / want.length;
}

/** 관대한 정답 임계값 — 오류율이 이 값 이하이면 정답. */
export const SPEECH_PASS_THRESHOLD = 0.34;

/** 따라말하기/소리내어읽기 정답 판정(관대). */
export function isSpeechCorrect(
  transcript: string,
  target: string,
  mode: 'word' | 'sentence',
): boolean {
  if (normalize(transcript).length === 0) return false;
  return speechErrorRate(transcript, target, mode) <= SPEECH_PASS_THRESHOLD;
}
