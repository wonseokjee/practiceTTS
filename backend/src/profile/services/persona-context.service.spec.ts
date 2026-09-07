import { PersonaContextService } from './persona-context.service';
import type { ProfileService, PersonaSource } from '../profile.service';

/**
 * PersonaContextService 단위 테스트 (계획서 Phase 5-1).
 *
 * PII 경계의 핵심 로직이므로 다음을 검증한다:
 * - 실명이 tokenizedContext(외부 LLM 전달분)에 남지 않을 것
 * - 부분 문자열 오치환이 없을 것 (긴 이름 우선)
 * - 역치환이 실명을 복원하고, 미매핑 토큰은 라벨로 폴백할 것
 * - 프로필 미등록 시 개인화를 생략하되 무중단일 것
 */
describe('PersonaContextService', () => {
  let service: PersonaContextService;
  let personaSource: PersonaSource | null;

  beforeEach(() => {
    personaSource = null;
    const profileServiceStub = {
      getPersonaSource: jest.fn(() => Promise.resolve(personaSource)),
    } as unknown as ProfileService;
    service = new PersonaContextService(profileServiceStub);
  });

  const sourceWith = (overrides: Partial<PersonaSource>): PersonaSource => ({
    hometown: null,
    occupation: null,
    hobbies: [],
    significantPlaces: [],
    family: [],
    ...overrides,
  });

  describe('buildPersonaContext', () => {
    it('가족 실명을 관계 토큰으로 치환하고 tokenMap을 생성한다', async () => {
      personaSource = sourceWith({
        family: [
          { relation: 'son', name: '철수', gender: 'M', relationOrdinal: 1 },
          {
            relation: 'grandson',
            name: '민준',
            gender: 'M',
            relationOrdinal: 1,
          },
        ],
      });

      const { tokenizedContext, tokenMap } = await service.buildPersonaContext(
        'patient-1',
        '철수랑 민준이랑 바다 갔어',
      );

      expect(tokenizedContext).not.toContain('철수');
      expect(tokenizedContext).not.toContain('민준');
      expect(tokenizedContext).toContain('[아들1]');
      expect(tokenizedContext).toContain('[손자1]');
      expect(tokenMap['[아들1]']).toBe('철수');
      expect(tokenMap['[손자1]']).toBe('민준');
    });

    it('프로필 미등록이면 baseContext를 그대로 반환하고 tokenMap은 비어있다', async () => {
      personaSource = null;

      const result = await service.buildPersonaContext(
        'patient-x',
        '오늘 산책을 했어요',
      );

      expect(result.tokenizedContext).toBe('오늘 산책을 했어요');
      expect(result.tokenMap).toEqual({});
    });

    it('부분 문자열이 겹치는 이름은 긴 이름을 우선 치환해 오치환하지 않는다', async () => {
      personaSource = sourceWith({
        family: [
          {
            relation: 'daughter',
            name: '영희',
            gender: 'F',
            relationOrdinal: 1,
          },
          {
            relation: 'friend',
            name: '영희자',
            gender: 'F',
            relationOrdinal: 1,
          },
        ],
      });

      const { tokenizedContext, tokenMap } = await service.buildPersonaContext(
        'patient-2',
        '영희자와 영희가 함께 왔다',
      );

      expect(tokenizedContext).not.toContain('영희');
      // "영희자"가 "영희"로 잘려 오치환되지 않았는지 (긴 이름 우선)
      expect(tokenMap['[친구1]']).toBe('영희자');
      expect(tokenMap['[딸1]']).toBe('영희');
    });

    it('배경 부가로 실명이 다시 섞여도 안전망이 봉합한다 (LLM 유출 차단)', async () => {
      // 직업 텍스트에 가족 실명이 우연히 포함된 경우
      personaSource = sourceWith({
        occupation: '철수건설 대표',
        family: [
          { relation: 'son', name: '철수', gender: 'M', relationOrdinal: 1 },
        ],
      });

      const { tokenizedContext } = await service.buildPersonaContext(
        'patient-3',
        '아들과 저녁을 먹었다',
      );

      // 배경 문장의 "철수건설"에 남은 실명도 봉합되어야 한다
      expect(tokenizedContext).not.toContain('철수');
      expect(tokenizedContext).toContain('[아들1]');
    });

    it('라틴 문자 이름이 더 긴 낱말 속에 걸려 오치환되지 않는다', async () => {
      // 부분 문자열 치환이면 "Also"의 "Al"이 걸려 "[아들1]so"가 된다.
      personaSource = sourceWith({
        family: [
          { relation: 'son', name: 'Al', gender: 'M', relationOrdinal: 1 },
        ],
      });

      const { tokenizedContext } = await service.buildPersonaContext(
        'patient-en-1',
        'Al also went to the park. Alice waved.',
      );

      expect(tokenizedContext).toBe(
        '[아들1] also went to the park. Alice waved.',
      );
    });

    it('라틴 문자 이름에 한국어 조사가 붙어도 치환한다', async () => {
      // 경계를 `\b`나 `\p{L}`로 잡으면 조사(이랑)가 붙은 실명을 놓쳐
      // 그대로 LLM에 나간다. 인접 금지는 라틴 문자·숫자만이어야 한다.
      personaSource = sourceWith({
        family: [
          { relation: 'son', name: 'Al', gender: 'M', relationOrdinal: 1 },
        ],
      });

      const { tokenizedContext } = await service.buildPersonaContext(
        'patient-en-2',
        'Al이랑 바다에 갔다',
      );

      expect(tokenizedContext).toBe('[아들1]이랑 바다에 갔다');
      expect(tokenizedContext).not.toContain('Al');
    });

    it('악센트가 든 이름도 치환한다 (\\b로는 안 잡힌다)', async () => {
      personaSource = sourceWith({
        family: [
          {
            relation: 'daughter',
            name: 'José',
            gender: 'F',
            relationOrdinal: 1,
          },
        ],
      });

      const { tokenizedContext } = await service.buildPersonaContext(
        'patient-en-3',
        'José came by today',
      );

      expect(tokenizedContext).toBe('[딸1] came by today');
    });

    it('이름에 든 정규식 메타문자가 패턴으로 해석되지 않는다', async () => {
      // 이스케이프를 빠뜨리면 "A.B"의 `.`가 임의 문자가 되어 "AXB"까지 삼킨다.
      personaSource = sourceWith({
        family: [
          { relation: 'friend', name: 'A.B', gender: 'M', relationOrdinal: 1 },
        ],
      });

      const { tokenizedContext } = await service.buildPersonaContext(
        'patient-en-4',
        'A.B and AXB are different',
      );

      expect(tokenizedContext).toBe('[친구1] and AXB are different');
    });

    it('고향/의미있는 장소를 장소 토큰으로 치환한다', async () => {
      personaSource = sourceWith({
        hometown: '강릉',
        significantPlaces: ['경포호'],
      });

      const { tokenizedContext, tokenMap } = await service.buildPersonaContext(
        'patient-4',
        '강릉 경포호에 다녀왔다',
      );

      expect(tokenizedContext).not.toContain('강릉');
      expect(tokenizedContext).not.toContain('경포호');
      expect(tokenMap['[장소1]']).toBe('강릉');
      expect(tokenMap['[장소2]']).toBe('경포호');
    });
  });

  describe('tokenizeWithMap', () => {
    it('tokenMap의 실명을 토큰으로 치환한다', () => {
      const out = service.tokenizeWithMap('철수랑 민준이가 왔다', {
        '[아들1]': '철수',
        '[손자1]': '민준',
      });
      expect(out).toBe('[아들1]랑 [손자1]이가 왔다');
      expect(out).not.toContain('철수');
      expect(out).not.toContain('민준');
    });

    it('긴 실명을 우선 치환해 부분 문자열을 깨뜨리지 않는다', () => {
      const out = service.tokenizeWithMap('영희자와 영희', {
        '[딸1]': '영희',
        '[친구1]': '영희자',
      });
      expect(out).toBe('[친구1]와 [딸1]');
    });

    it('tokenMap이 비면(프로필 미등록) 원문을 그대로 반환한다', () => {
      expect(service.tokenizeWithMap('철수랑 갔다', {})).toBe('철수랑 갔다');
    });

    it('빈 문자열은 그대로 반환한다', () => {
      expect(service.tokenizeWithMap('', { '[아들1]': '철수' })).toBe('');
    });
  });

  describe('restorePersonaText', () => {
    it('토큰을 실명으로 복원한다', () => {
      const restored = service.restorePersonaText('[손자1]와 함께 갔던 곳', {
        '[손자1]': '민준',
      });
      expect(restored).toBe('민준와 함께 갔던 곳');
    });

    it('매핑에 없는 토큰은 관계 라벨로 폴백하고 토큰을 남기지 않는다', () => {
      const restored = service.restorePersonaText('[아들2]는 어디에?', {});
      expect(restored).toBe('아들는 어디에?');
      expect(restored).not.toContain('[');
    });

    it('장소 토큰도 폴백되어 대괄호가 남지 않는다', () => {
      const restored = service.restorePersonaText('[장소1]에 갔다', {});
      expect(restored).toBe('장소에 갔다');
    });

    it('한국어가 아닌 라벨의 미매핑 토큰도 폴백한다', () => {
      // 라벨 부류가 `[가-힣]`이면 이 토큰이 그물을 통과해 환자 화면에 뜬다.
      const restored = service.restorePersonaText('[Son1] is here', {});
      expect(restored).toBe('Son is here');
      expect(restored).not.toContain('[');
    });
  });

  describe('buildTokenMap', () => {
    it('buildPersonaContext와 동일한 매핑을 결정적으로 재생성한다', async () => {
      personaSource = sourceWith({
        family: [
          { relation: 'son', name: '철수', gender: 'M', relationOrdinal: 1 },
        ],
        hometown: '강릉',
      });

      const { tokenMap: buildMap } = await service.buildPersonaContext(
        'patient-5',
        '',
      );
      const standaloneMap = await service.buildTokenMap('patient-5');

      expect(standaloneMap).toEqual(buildMap);
    });

    it('프로필 미등록이면 빈 매핑을 반환한다', async () => {
      personaSource = null;
      expect(await service.buildTokenMap('patient-none')).toEqual({});
    });
  });
});
