// Warm Clinical 디자인 공유 상수 (DESIGN.md 기반)
//
// 환자 흐름 화면(훈련/대시보드/퀴즈)에서 배경·카드 스타일을 일관되게 유지하기 위한
// 단일 출처. Tailwind 토큰으로 표현하기 어려운 커스텀 그라데이션은 인라인 style로,
// 반복되는 카드/버튼 클래스 조합은 문자열 상수로 공유한다.

/**
 * 시안 A "따뜻한 회상" 배경 — 그린 절반 그라데이션.
 * 위 절반은 세이지 그린(#EBF4F0), 50% 지점부터 피치(#FBEAE0)로 전환된다.
 * 인라인 style의 `background` 값으로 사용한다.
 */
export const WARM_SCREEN_BG =
  'linear-gradient(180deg,#EBF4F0 0%,#EBF4F0 28%,#F4F1EC 50%,#FBEAE0 100%)';

/** 반투명 흰 카드 — 배경 그라데이션이 은은하게 비치는 기본 카드 스타일 */
export const WARM_CARD =
  'bg-white/85 border border-white/90 rounded-3xl shadow-[0_6px_18px_rgba(0,0,0,0.05)]';
