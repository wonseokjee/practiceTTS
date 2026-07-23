/**
 * 한마디→발화연습 변환 클라이언트 추상화 (FastAPI `/wish/to-practice` 호출 경계).
 * 양방향 치유 v1 (Pattern 1).
 */

/** 빈칸 채우기 1문항 (camelCase 정규화) */
export interface WishFillBlank {
  prompt: string;
  answer: string;
  hintFirstChar: string;
}

/** 변환 결과 */
export interface WishConversionResult {
  /** 따라말하기용 문장 (한마디 원문) */
  echoSentence: string;
  /** 빈칸 채우기 문항 */
  fillBlank: WishFillBlank;
  model: string;
  fallbackUsed: boolean;
}

export interface IWishConversionClient {
  /** 한마디 문장 → 발화 연습(따라말하기 + 빈칸) 변환 */
  convert(wishMessage: string): Promise<WishConversionResult>;
}

/** DI 토큰 */
export const WISH_CONVERSION_CLIENT = Symbol('WISH_CONVERSION_CLIENT');
