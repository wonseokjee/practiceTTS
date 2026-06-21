// 그림 이름대기(naming) 로컬 채점 — STT 인식 텍스트와 정답 이름의 관대한 비교.
//
// 실어증 환자 + 브라우저 STT 특성상 정확 일치는 비현실적이라 관대하게 본다.
//  - 공백 제거, NFC 정규화, 소문자화 후
//  - 완전 일치, 혹은 한쪽이 다른 쪽을 포함하면 정답으로 본다
//    (예: "사과요" / "사과입니다" → "사과" 정답 처리).

/** 비교용 정규화: NFC + 공백 제거 + 소문자. */
function normalizeName(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

/** STT 인식 텍스트가 정답 이름과 일치하는지(관대) 판정. */
export function isNameMatch(transcript: string, targetWord: string): boolean {
  const said = normalizeName(transcript);
  const target = normalizeName(targetWord);
  if (said.length === 0 || target.length === 0) return false;
  return said === target || said.includes(target) || target.includes(said);
}
