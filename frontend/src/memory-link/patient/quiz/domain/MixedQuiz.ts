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
export interface QabImageChoice {
  choiceId: string;
  /** 이미지 설명/라벨 (단어 or altText) */
  label: string;
  imageUrl: string;
  isCorrect: boolean;
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
}

/**
 * 플레이어가 순서대로 푸는 단일 항목.
 * - daily: 백엔드 데일리 문항 (객관식/타일/말하기 등) — 백엔드로 채점
 * - qab: QAB 질문형(단어/문장 이해, 듣고 그림 고르기) — 로컬 채점
 * - naming: QAB 그림 이름대기(보고 말하기) — 로컬 STT 채점
 * - repeat: QAB 따라말하기(듣고 따라 말하기) — 로컬 WER 채점
 * - reading: QAB 소리 내어 읽기(보고 읽기) — 로컬 WER 채점
 * - ddk: QAB 말운동(음절 반복) — 로컬 피크 카운트 채점
 */
export type PlayableItem =
  | { kind: 'daily'; id: string; question: QuizQuestionPublic }
  | { kind: 'qab'; id: string; item: QabImageItem }
  | { kind: 'naming'; id: string; item: QabNamingItem }
  | { kind: 'repeat'; id: string; item: QabRepeatItem }
  | { kind: 'reading'; id: string; item: QabReadingItem }
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
