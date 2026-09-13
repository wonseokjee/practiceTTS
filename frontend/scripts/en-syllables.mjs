// 영어 자극의 음절 수를 CMUdict로 센다 — **저작 도구**다. 앱은 이 파일을 쓰지 않는다.
//
// 영어판 콘텐츠는 음절 수를 JSON 필드로 박는다(설계: docs/history/
// 20260913_EnglishSpeechContent_design.md §4). 런타임에 세면 사전·미등재어
// 폴백·그 폴백의 표시가 전부 앱에 들어온다. 그래서 세는 일은 저작 시점에 한 번,
// 여기서만 한다. 테스트도 같은 함수로 적힌 값을 대조한다 — 손으로 고친 값이
// 섞이면 거기서 깨진다.
//
// 음절 = CMUdict 발음에서 강세 숫자(0·1·2)가 붙은 모음 음소의 수.
// 사전에 없는 말은 null — 조용히 추정하지 않는다. 호출부가 실패시킨다.
//
// 사용: node scripts/en-syllables.mjs <후보.json>
//   후보 JSON의 문자열 배열(키 무관)을 모두 훑어 {text, syllables, oov}를 출력한다.

import { readFileSync } from 'node:fs';
import { dictionary } from 'cmu-pronouncing-dictionary';

/** 낱말 하나의 음절 수. 사전에 없으면 null. */
export function syllablesOfWord(word) {
  const phones = dictionary[word.toLowerCase()];
  if (phones === undefined) return null;
  return phones.split(' ').filter((p) => /\d$/.test(p)).length;
}

/** 문장·낱말의 음절 수 합과 사전에 없는 낱말 목록. 하나라도 없으면 syllables는 null. */
export function syllablesOf(text) {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let total = 0;
  const oov = [];
  for (const token of tokens) {
    const n = syllablesOfWord(token);
    if (n === null) oov.push(token);
    else total += n;
  }
  return { syllables: oov.length > 0 ? null : total, oov };
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (key !== 'note') collectStrings(v, out);
    }
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain && process.argv[2]) {
  const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const rows = collectStrings(data).map((text) => ({ text, ...syllablesOf(text) }));
  console.log(JSON.stringify(rows, null, 2));
}
