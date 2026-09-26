import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  MAX_COMPETITORS,
  MAX_COMPETITOR_LEN,
  parseCompetitors,
  parseSttCompetitor,
} from './competitors';

describe('parseCompetitors', () => {
  it('안 보냈거나 비었으면 빈 목록이다(경쟁자 모드가 아니다)', () => {
    expect(parseCompetitors(undefined)).toEqual([]);
    expect(parseCompetitors(null)).toEqual([]);
    expect(parseCompetitors('')).toEqual([]);
    expect(parseCompetitors('[]')).toEqual([]);
  });

  it('JSON 문자열 배열을 받아 앞뒤 공백을 떼고 빈 항목을 버린다', () => {
    expect(parseCompetitors('["구름"," 가위 ","", "  "]')).toEqual([
      '구름',
      '가위',
    ]);
  });

  it('형식이 틀리면 null이다', () => {
    for (const raw of [
      'not json',
      '{"a":1}',
      '"구름"',
      '[1,2]',
      '["구름",3]',
      '[null]',
      '[["구름"]]',
    ]) {
      expect(parseCompetitors(raw)).toBeNull();
    }
  });

  it('같은 필드를 여러 번 보내 배열로 오면 거부한다', () => {
    expect(parseCompetitors(['["구름"]', '["가위"]'])).toBeNull();
    expect(parseCompetitors(5)).toBeNull();
  });

  it('상한 경계: 5개·30자는 받고 6개·31자는 거부한다', () => {
    const five = JSON.stringify(['가', '나', '다', '라', '마']);
    expect(parseCompetitors(five)).toHaveLength(MAX_COMPETITORS);
    expect(parseCompetitors(JSON.stringify(['가'.repeat(30)]))).toEqual([
      '가'.repeat(30),
    ]);
    expect(parseCompetitors(JSON.stringify(Array(6).fill('가')))).toBeNull();
    expect(parseCompetitors(JSON.stringify(['가'.repeat(31)]))).toBeNull();
  });

  it('개수 상한은 정리 전 원본 기준이다 — 빈 항목도 센다', () => {
    expect(
      parseCompetitors(JSON.stringify(['가', '', '', '', '', ''])),
    ).toBeNull();
  });
});

describe('parseSttCompetitor', () => {
  it('안 보내면 false, true/false 두 값만 받는다', () => {
    expect(parseSttCompetitor(undefined)).toBe(false);
    expect(parseSttCompetitor('')).toBe(false);
    expect(parseSttCompetitor('true')).toBe(true);
    expect(parseSttCompetitor('false')).toBe(false);
  });

  it('그 밖의 표기는 거부한다', () => {
    for (const raw of ['TRUE', '1', 'yes', 'maybe', true, ['true']]) {
      expect(parseSttCompetitor(raw)).toBeNull();
    }
  });
});

// 프록시와 ai-service의 상한이 어긋나면 그 사이 구간이 "받아주지만 반드시 거절되는" 죽은
// 구간이 된다. 두 값을 소스에서 직접 읽어 대조한다(ai-service 소스가 없는 환경에서는 건너뛴다).
const AI = join(__dirname, '..', '..', '..', 'ai-service');
const SERVICE = join(AI, 'services', 'competitor_service.py');
const ROUTER = join(AI, 'routers', 'pronunciation.py');
const drift = existsSync(SERVICE) && existsSync(ROUTER) ? it : it.skip;

describe('ai-service 상한과의 일치', () => {
  drift('MAX_COMPETITORS·MAX_COMPETITOR_LEN이 ai-service와 같다', () => {
    const n = /^MAX_COMPETITORS\s*=\s*(\d+)/m.exec(
      readFileSync(SERVICE, 'utf-8'),
    );
    const len = /^MAX_COMPETITOR_LEN\s*=\s*(\d+)/m.exec(
      readFileSync(ROUTER, 'utf-8'),
    );
    expect(n).not.toBeNull();
    expect(len).not.toBeNull();
    expect(MAX_COMPETITORS).toBe(Number(n![1]));
    expect(MAX_COMPETITOR_LEN).toBe(Number(len![1]));
  });
});
