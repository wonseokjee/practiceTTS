/**
 * 단어 이해 (WordComp) 검사 - 오답 유형 값 객체
 *
 * 오답 선택지의 유형을 분류한다.
 * - semantic: 의미적 혼동 (같은 범주의 다른 단어)
 * - phonemic: 음운적 혼동 (발음이 유사한 다른 단어)
 * - unrelated: 무관한 단어 (범주 및 음운 모두 무관)
 */

export type DistractorType = 'semantic' | 'phonemic' | 'unrelated';
