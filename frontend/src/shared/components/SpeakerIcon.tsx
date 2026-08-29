// 스피커 아이콘 — 소리와 관련된 자리에 쓴다.
//
// **왜 이모지를 안 쓰나.** 소리 테스트 화면은 🔊를 60px로 띄워 그 화면에서 가장 큰
// 그림으로 삼고 있었다. 이모지는 플랫폼이 글립을 정한다 — Windows·iOS·Android가
// 서로 다른 그림을 그리고, 어떤 조합에서는 흑백 폰트 글립으로 떨어진다. 화면의
// 주된 시각 요소를 그렇게 둘 수는 없다.
//
// 아이콘 자체는 새로 그리지 않았다. `assessments/wordComp/AudioPlayerBar`가 이미
// 같은 스피커를 인라인 SVG로 쓰고 있어서 그 path를 여기로 옮기고 그쪽도 이걸
// 쓰게 했다 — 앱 안에서 "소리"를 뜻하는 그림이 두 종류가 되면 안 된다. 그래서
// memory-link가 아니라 중립 위치(`src/shared`)에 둔다.
//
// `currentColor`를 쓰므로 색은 부모가 정한다.

interface SpeakerIconProps {
  /** Tailwind 크기·색 클래스. 예: `h-16 w-16 text-[#2D6A56]` */
  className?: string;
}

export function SpeakerIcon({ className }: SpeakerIconProps) {
  return (
    <svg
      className={className}
      fill="currentColor"
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.617.786L4.17 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.17l4.213-3.786a1 1 0 011 .076zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
        clipRule="evenodd"
      />
    </svg>
  );
}
