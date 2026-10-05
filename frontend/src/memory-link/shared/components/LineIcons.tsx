// 선 아이콘 — 이모지 대신 쓴다.
//
// 이모지는 기기마다 모양이 달라(삼성·애플) 위기 연결처처럼 신뢰가 걸린 자리에서
// 톤이 흔들린다(2026-10-05 디자인 리뷰 결정 10). 1.5px 선, 색은 글자색을 따른다.
// 장식이므로 aria-hidden — 뜻은 옆 글자가 전한다.

interface IconProps {
  size?: number;
  className?: string;
}

export function LockIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function PhoneIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
    </svg>
  );
}
