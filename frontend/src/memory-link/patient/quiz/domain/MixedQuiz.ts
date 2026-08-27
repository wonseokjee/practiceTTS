// 통합 퀴즈(혼합 세트) 도메인 타입
//
// 한 세트는 "데일리 퀴즈(백엔드 생성·채점)"와 "QAB 질문형(프론트 뱅크·로컬 채점)"을
// 섞어서 진행한다. 두 출처를 하나의 플레이어에서 다루기 위해 판별 유니온으로 표현한다.
//
// QAB 질문형은 현재 wordComp(단어 듣고 그림)·sentComp(문장 듣고 그림) 둘 다
// "들려주고 → 그림 고르기"로 형태가 같아 하나의 이미지 선택형 타입으로 일반화한다.

import type { QuizQuestionPublic } from './Quiz.js';
import type { PronunciationGrade } from './pronunciationScore.js';

/** QAB 이미지 선택지 (프론트 로컬 채점을 위해 isCorrect 포함). */
/**
 * 오답이 어느 갈래인가 — 단어이해 문항에만 붙는다.
 *
 * 실어증 단어-그림 대응에서 유인지는 두 종류이고 서로 **다른 손상**을 잡는다.
 * `semantic`을 반복해 고르면 의미 체계 쪽, `phonological`이면 음운 처리 쪽이다.
 * 정답률 하나로는 둘을 구분할 수 없다.
 *
 * **뽑을 때 붙인다.** 나중에 라벨과 범주를 보고 되짚을 수도 있지만, 그러면
 * 실제로 어느 통에서 뽑혔는지와 어긋날 수 있다(같은 낱말이 두 조건을 동시에
 * 만족하는 경우). 만든 쪽이 아는 사실을 그대로 들고 다니게 한다.
 */
export type QabFoilKind = 'semantic' | 'phonological' | 'unrelated';

export interface QabImageChoice {
  choiceId: string;
  /** 이미지 설명/라벨 (단어 or altText) */
  label: string;
  imageUrl: string;
  isCorrect: boolean;
  /** 오답의 갈래. 정답과 문장이해 선택지에는 없다. */
  foilKind?: QabFoilKind;
}

/** QAB 질문형 문항 (들려준 단어/문장에 맞는 그림 고르기). */
export interface QabImageItem {
  itemId: string;
  /** 출처 분류 — 단어이해 / 문장이해 */
  category: 'word' | 'sentence';
  /** TTS로 들려줄 텍스트 (단어 또는 문장) */
  promptText: string;
  /** 화면 안내 문구 */
  instruction: string;
  choices: QabImageChoice[];
  /**
   * 이 문항이 제시된 난이도 레벨(1~5). 적응형 레벨링이 "현재 레벨에서 제시된
   * 항목"만 윈도우로 세도록 결과 제출 시 백엔드에 함께 보낸다. 미지정(레거시)
   * 이면 백엔드가 레벨링 윈도우에서 제외한다.
   */
  presentedLevel?: number;
}

/**
 * QAB 그림 이름대기(검사5) 문항 — 그림을 보고 "말로" 이름을 답한다.
 * 선택지가 없고 STT 인식 텍스트를 targetWord와 관대하게 비교해 로컬 채점한다.
 * (정답을 들려주면 안 되므로 TTS 발음 단서는 제공하지 않는다.)
 */
export interface QabNamingItem {
  itemId: string;
  /** 이름을 말해야 하는 대상 그림 */
  imageUrl: string;
  /** 정답 이름 (말로 답해야 하는 단어) — 로컬 채점 기준 */
  targetWord: string;
  /** 화면 안내 문구 */
  instruction: string;
  /** 제시된 난이도 레벨(1~5). 결과 제출 시 백엔드 레벨링 윈도우에 사용. */
  presentedLevel?: number;
}

/**
 * QAB 따라말하기(검사6) 문항 — 들려준 단어/문장을 듣고 따라 말한다.
 * TTS 모범 발음 제공 후 STT 인식 → WER 관대 채점.
 */
export interface QabRepeatItem {
  itemId: string;
  category: 'word' | 'sentence';
  /** 들려주고 따라 말할 내용 */
  text: string;
  instruction: string;
  /** 제시된 난이도 레벨(1~5). 결과 제출 시 실제 제시값으로 기록된다. */
  presentedLevel?: number;
}

/**
 * QAB 소리 내어 읽기(검사7) 문항 — 화면 문장을 보고 소리 내어 읽는다.
 * 모범 발음(TTS)은 주지 않고(스스로 읽기), STT 인식 → WER 관대 채점.
 */
export interface QabReadingItem {
  itemId: string;
  /** 보고 소리 내어 읽을 내용 */
  text: string;
  instruction: string;
  /** 제시된 난이도 레벨(1~5). 결과 제출 시 실제 제시값으로 기록된다. */
  presentedLevel?: number;
}

/**
 * QAB 글자 조합 문항 — 섞인 음절 타일을 눌러 목표 단어를 만든다(산출 과제).
 *
 * 출처는 **커리큘럼 단어 풀**이다. 예전에는 보호자 메모에서 만든 빈칸 문항을
 * 변환해 썼는데, 그러면 한 문항이 기억 회상과 음절 조합을 동시에 물어 무엇을
 * 못한 건지 분리되지 않았고 같은 목표가 반복되지도 않았다.
 *
 * 난이도는 **방해 타일 수**로 조절한다(레벨이 정한다). 상용 실어증 치료 도구가
 * 이 과제를 단어 길이 × 방해 글자 0/2/4개로 등급화하는 것과 같은 축이다.
 */
export interface QabSpellItem {
  itemId: string;
  /** 만들어야 하는 목표 단어 — 로컬 채점 기준 */
  targetWord: string;
  /** 단서로 함께 보여주는 그림(단어 풀에 있는 경우) */
  imageUrl: string;
  /** 셔플된 음절 타일 (정답 음절 + 방해 음절) */
  tiles: string[];
  instruction: string;
  /** 제시된 난이도 레벨(1~5). 결과 제출 시 백엔드 레벨링 윈도우에 사용. */
  presentedLevel?: number;
}

/**
 * QAB 말운동/교대운동속도(검사8, DDK) 문항 — 한 음절을 빠르게 반복.
 * 마이크 녹음 → 음절 피크 수를 세어 targetCount 이상이면 통과(로컬 채점).
 */
export interface QabDdkItem {
  itemId: string;
  /** 반복할 음절 (예: "퍼", "퍼터커") */
  syllable: string;
  /** 화면 표기 (예: "퍼-터-커") */
  label: string;
  /** 통과 기준 반복 횟수 */
  targetCount: number;
  instruction: string;
  /** 제시된 난이도 레벨(1~5). 결과 제출 시 실제 제시값으로 기록된다. */
  presentedLevel?: number;
}

/**
 * 플레이어가 순서대로 푸는 단일 항목.
 * - daily: 백엔드 데일리 문항 (객관식/타일/말하기 등) — 백엔드로 채점
 * - qab: QAB 질문형(단어/문장 이해, 듣고 그림 고르기) — 로컬 채점
 * - naming: QAB 그림 이름대기(보고 말하기) — 로컬 STT 채점
 * - repeat: QAB 따라말하기(듣고 따라 말하기) — 로컬 WER 채점
 * - reading: QAB 소리 내어 읽기(보고 읽기) — 로컬 WER 채점
 * - spell: QAB 글자 조합(음절 타일로 단어 만들기) — 로컬 문자열 비교 채점
 * - ddk: QAB 말운동(음절 반복) — 로컬 피크 카운트 채점
 */
export type PlayableItem =
  | { kind: 'daily'; id: string; question: QuizQuestionPublic }
  | { kind: 'qab'; id: string; item: QabImageItem }
  | { kind: 'naming'; id: string; item: QabNamingItem }
  | { kind: 'repeat'; id: string; item: QabRepeatItem }
  | { kind: 'reading'; id: string; item: QabReadingItem }
  | { kind: 'spell'; id: string; item: QabSpellItem }
  | { kind: 'ddk'; id: string; item: QabDdkItem };

/** 항목 채점 결과 (데일리/QAB 공통) */
export interface PlayResult {
  isCorrect: boolean;
  /** 피드백에 노출할 정답 표기 (데일리=correctAnswer, QAB=정답 라벨) */
  correctLabel: string | null;
  /** 발음 5단계 등급 (발화 항목만). 어르신 격려 문구 표시에 사용 */
  grade?: PronunciationGrade;
  /** 어르신용 격려 문구 (발화 항목만) */
  encouragement?: string;
}
