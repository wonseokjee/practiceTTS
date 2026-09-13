import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type LocaleField,
} from './locale';

describe('SUPPORTED_LOCALES', () => {
  const fields: LocaleField[] = ['patient', 'caregiver'];

  it.each(fields)(
    '%s 목록은 항상 기본 로케일을 포함한다 — 빠지면 기존 사용자 값이 전부 미지원이 된다',
    (field) => {
      expect(SUPPORTED_LOCALES[field]).toContain(DEFAULT_LOCALE);
      expect(isSupportedLocale(field, DEFAULT_LOCALE)).toBe(true);
    },
  );

  /**
   * **문이 닫혀 있다는 것을 고정한다.** 영어판 문을 여는 PR은 이 테스트도 같이
   * 고쳐야 한다 — 그 PR의 검토자가 "여는 조건이 찼나"를 한 번 더 보게 하는
   * 의도된 마찰이다(계획서 §16: 보호자 문은 T7 컴플라이언스 뒤, 환자 문은
   * 문항 풀 밴드 116 뒤).
   */
  it('지금은 두 문 모두 닫혀 있다 — en-US 미지원', () => {
    expect(SUPPORTED_LOCALES).toEqual({
      patient: ['ko-KR'],
      caregiver: ['ko-KR'],
    });
    expect(isSupportedLocale('caregiver', 'en-US')).toBe(false);
    expect(isSupportedLocale('patient', 'en-US')).toBe(false);
  });

  it('형식이 비슷해도 목록에 정확히 있어야 한다', () => {
    expect(isSupportedLocale('patient', 'ko')).toBe(false);
    expect(isSupportedLocale('patient', 'ko-kr')).toBe(false);
    expect(isSupportedLocale('patient', '')).toBe(false);
  });
});
