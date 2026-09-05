// 소리 사전 점검 화면 — 검사·연습에 들어가기 전에 한 번.
//
// **무엇을 메우는가.** TODO-110에서 "소리가 안 났다"를 환자에게 알리게 했지만,
// 거기서 잡을 수 있는 것은 **재생 API가 실패했을 때**까지다. 목소리가 하나도
// 없거나 기기가 음소거여도 브라우저는 `onend`를 발화하고 성공이라고 말한다.
// 기계가 알 수 없는 것은 사람에게 묻는 수밖에 없다 — 이 화면이 그 질문이다.
//
// **왜 문항 안이 아니라 앞인가.** 소리 없이 검사를 끝까지 치르면 듣기 문항의
// 기록은 전부 찍기가 된다. 그 기록은 회복 추세에 들어가 없는 퇴행을 만든다.
// 30문항을 버리기 전에 한 문장을 들려보는 편이 싸다.
//
// **환자가 혼자 누른다.** 보호자가 옆에 있다는 보장이 없다(솔로 홈). 그래서
// 질문은 예/아니오 둘뿐이고, 안내는 "기기 설정" 같은 말 대신 손으로 할 수
// 있는 동작으로 적는다.
//
// **막지 않는다.** 소리가 끝내 안 나도 "소리 없이 시작하기"를 남긴다. 못
// 듣는 것보다 갇히는 것이 나쁘다(TODO-110에서 선택지를 잠그지 않은 것과 같은
// 이유). 대신 그 경우는 통과로 **기록하지 않아** 다음에 다시 묻는다.

import { useEffect, useMemo, useRef, useState } from "react";
import { SpeakerIcon } from "../../../shared/components/SpeakerIcon.js";
import { useTTS } from "../../../shared/hooks/useTTS.js";
import { createTtsService } from "../../../shared/infrastructure/ttsFactory.js";

/**
 * 확인용으로 들려주는 문장.
 *
 * 들리면 질문 자체가 들린다 — 문구가 곧 시험 신호다. 억양이 있는 의문문이라
 * 무음/잡음과 구별하기도 쉽다.
 */
export const SOUND_CHECK_PHRASE = "소리가 잘 들리시나요?";

interface SoundCheckScreenProps {
  /** "잘 들려요" — 통과로 기록하고 세션으로 보낸다 */
  onPass: () => void;
  /** "소리 없이 시작하기" — 기록하지 않고 세션으로 보낸다 */
  onSkip: () => void;
  /** "돌아가기" — 세션을 시작하지 않는다 */
  onCancel: () => void;
  /** 무엇을 시작하려던 참인지 (문구용) */
  destination: "검사" | "연습";
}

export function SoundCheckScreen({
  onPass,
  onSkip,
  onCancel,
  destination,
}: SoundCheckScreenProps) {
  const ttsService = useMemo(() => createTtsService(), []);
  const { isPlaying, error: ttsError, speak } = useTTS(ttsService);
  /** 한 번이라도 재생을 시도해 끝났는가 — 묻기 전에 들려줘야 한다. */
  const [hasPlayed, setHasPlayed] = useState(false);
  /** 환자가 "안 들려요"를 골랐는가. */
  const [declined, setDeclined] = useState(false);
  const didAutoPlayRef = useRef(false);

  const play = async (): Promise<void> => {
    // 다시 듣기는 안내 화면에서도 누른다. 다시 들려주는 김에 질문으로 되돌린다.
    setDeclined(false);
    await speak(SOUND_CHECK_PHRASE);
    setHasPlayed(true);
  };

  // 들어오자마자 한 번 들려준다. 어르신에게 버튼을 한 번 덜 누르게 하는 것이
  // 이 화면의 유일한 최적화다. 자동재생이 막히면 아래 버튼이 그대로 남는다.
  useEffect(() => {
    if (didAutoPlayRef.current) return;
    didAutoPlayRef.current = true;
    void play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 재생 API가 실패했으면 물어볼 것도 없다 — 답은 이미 "안 들렸다"다.
  const showHelp = ttsError !== null || declined;

  return (
    /*
      **세로를 채운다.** 예전에는 위에서부터 쌓기만 해서 390×844 화면에서
      콘텐츠가 503px, 아래 342px(40%)이 비었다. 빈 것 자체보다 나쁜 게 둘 있었다 —
      기본 동작 버튼이 화면 위쪽이라 엄지가 올라가야 했고, `돌아가기`가 '안 들려요'
      바로 밑에 붙어 오탭 거리가 짧았다.

      본문은 남는 공간의 **가운데**에 두고 `돌아가기`는 **바닥**에 붙인다. 늘려서
      메우지 않는다 — 요소 사이를 벌리면 묶여 있어야 할 것들이 흩어진다.

      `min-h-dvh`다. `100vh`는 모바일에서 주소창을 포함한 높이라 바닥에 붙인
      버튼이 화면 밖으로 밀린다(index.css의 스크롤 주석과 같은 이유).
    */
    <div className="font-pretendard mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        {/*
        이 화면에서 가장 큰 그림이다. 이모지로 두면 플랫폼이 글립을 정하고
        (Windows·iOS·Android가 서로 다르게 그린다) 어떤 조합에서는 흑백 폰트
        글립으로 떨어진다. 주된 시각 요소를 그렇게 둘 수 없다.
      */}
        <SpeakerIcon className="h-16 w-16 text-primary" />
        <h2 className="text-2xl font-bold text-ink-sage">소리를 확인할게요</h2>
        <p className="text-center text-lg leading-relaxed text-muted-sage">
          {destination}에는 듣고 답하는 문제가 있어요.
          <br />
          소리가 잘 나오는지 먼저 확인해요.
        </p>

        <button
          type="button"
          onClick={() => void play()}
          disabled={isPlaying}
          className="min-h-[64px] w-full rounded-full bg-primary px-6 py-3 text-xl font-semibold text-white transition-colors duration-[180ms] ease-out hover:bg-primary-dark disabled:opacity-60"
        >
          {isPlaying ? (
            "소리 나는 중…"
          ) : (
            <span className="inline-flex items-center justify-center gap-2">
              <SpeakerIcon className="h-6 w-6" />
              소리 듣기
            </span>
          )}
        </button>

        {showHelp ? (
          <div className="w-full" role="alert">
            <p className="mb-4 text-center text-lg font-medium text-accent-ink">
              {ttsError !== null
                ? "이 기기에서 소리를 낼 수 없었어요."
                : "소리가 안 들리시는군요."}
            </p>
            {/*
            "볼륨" "설정" 같은 말은 쓰지 않는다. 손으로 할 수 있는 동작으로만
            적는다 — 옆에 도와줄 사람이 없을 수도 있다.
          */}
            <ol className="mb-4 flex list-decimal flex-col gap-2 rounded-2xl bg-accent-soft px-8 py-4 text-left text-lg leading-relaxed text-muted-sage">
              <li>기기 옆의 소리 버튼을 눌러 소리를 키워 주세요.</li>
              <li>무음(진동) 상태라면 소리가 나게 바꿔 주세요.</li>
              <li>이어폰을 쓰신다면 잘 꽂혔는지 봐 주세요.</li>
            </ol>
            <p className="mb-3 text-center text-base text-muted-sage">
              그런 다음 위의 <strong>소리 듣기</strong>를 한 번 더 눌러 주세요.
            </p>
            <button
              type="button"
              onClick={onSkip}
              className="min-h-[48px] w-full text-base text-muted-sage underline underline-offset-4"
            >
              소리 없이 시작하기
            </button>
          </div>
        ) : (
          hasPlayed && (
            <div className="w-full">
              <p
                className="mb-4 text-center text-xl font-medium text-ink-sage"
                role="status"
                aria-live="polite"
              >
                소리가 잘 들리셨나요?
              </p>
              {/*
              두 답의 **시각적 무게를 같게 둔다.** 예전에는 '잘 들려요'만 채워진
              버튼이라 눈에 먼저 들어왔다. 사용자는 만족화(satisficing)로 처음
              그럴듯한 선택지를 고르는데, 그 선택지가 곧 이 화면을 통과시키는
              쪽이었다 — 소리가 안 들리는 경우를 잡으려고 만든 게이트가 그 경우를
              시각적으로 억누른 셈이다.

              이건 CTA가 아니라 진단 질문이다. 어느 답도 '원하는 답'이 아니므로
              둘 다 같은 형태로 두고, 색으로만 갈래를 구분한다.
            */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onPass}
                  className="min-h-[64px] flex-1 rounded-full border-2 border-primary bg-white px-4 py-3 text-xl font-semibold text-primary transition-colors duration-[180ms] ease-out hover:bg-primary-light"
                >
                  잘 들려요
                </button>
                <button
                  type="button"
                  onClick={() => setDeclined(true)}
                  className="min-h-[64px] flex-1 rounded-full border-2 border-accent-strong bg-white px-4 py-3 text-xl font-semibold text-accent-ink transition-colors duration-[180ms] ease-out hover:bg-accent-soft"
                >
                  안 들려요
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {/*
        본문 밖이다. 이건 답이 아니라 **빠져나가는 길**이라, 답변 버튼과
        같은 덩어리에 두면 손가락이 헷갈린다.
      */}
      <button
        type="button"
        onClick={onCancel}
        className="mt-8 min-h-[48px] w-full text-base text-muted-sage underline underline-offset-4"
      >
        돌아가기
      </button>
    </div>
  );
}
