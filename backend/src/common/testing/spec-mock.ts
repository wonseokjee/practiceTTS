/**
 * 스펙에서 목을 만들 때 쓰는 기본형.
 *
 * ## 왜 필요한가
 *
 * `jest.fn()`의 인자 타입은 기본값이 `any[]`다. 그래서 목이 **무엇을 받았는지**
 * 꺼내 보는 순간(`mock.calls[0][0]`) 값이 any가 되고, 거기서 뻗어 나간 단언이
 * 전부 any로 물든다. 백엔드 스펙 린트 52건 중 41건이 이 한 뿌리였다.
 *
 * 문제는 린트 숫자가 아니다. 서비스가 저장소에 넘기는 인자 모양이 바뀌어도
 * `row.patientId`가 조용히 통과한다 — 필드 이름이 사라져도 `undefined`를
 * 비교하며 초록으로 남는다. 스펙이 무엇을 재고 있는지 아무도 모르게 된다.
 *
 * ## 무엇을 정하나
 *
 * **인자만** `unknown[]`으로 고정한다. 꺼낸 값을 쓰기 전에 좁히기를 강제하므로,
 * 그 좁히기가 곧 "이 스펙이 기대하는 인자 모양"의 선언이 된다.
 *
 * 반환은 `any`로 남긴다. `mockResolvedValue`의 타입이
 * `T extends PromiseLike<infer U> ? U | T : never`라, `T`를 `unknown`으로 두면
 * 인자 타입이 `never`가 되어 아무 값도 못 넣는다. 어차피 반환값은 각 테스트가
 * 직접 정하는 것이라 여기서 지켜 줄 것이 없다.
 *
 * 인자를 진짜로 아는 목(서비스가 넘기는 행처럼)은 이걸 쓰지 말고 제네릭을
 * 직접 적는다 — `jest.fn<Promise<void>, [InsertedRecording]>()`.
 */
export type SpecMock = jest.Mock<any, unknown[]>;

/** {@link SpecMock} 타입의 빈 목. */
export const specMock = (): SpecMock => jest.fn();
