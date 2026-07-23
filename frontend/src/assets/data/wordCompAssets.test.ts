import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import wordPool from './qabWordPool.json';

/**
 * Regression: ISSUE-005 — 검사용 그림 자산의 타당도 규칙을 테스트로 고정한다.
 * Found by /qa on 2026-07-19
 * Report: .gstack/qa-reports/qa-report-localhost-2026-07-19.md
 *
 * 자산은 frontend/scripts/generate-wordcomp-illustrations.py로 생성한다.
 * 손으로 한 장만 고쳐도 규칙이 깨질 수 있어 여기서 전수 검사한다.
 */

const ASSET_DIR = join(process.cwd(), 'public', 'assets', 'images', 'wordComp');

interface Choice {
  choiceId: string;
  label: string;
  imageUrl: string;
  isCorrect: boolean;
}
interface Item {
  itemId: string;
  targetWord: string;
  choices: Choice[];
}

const items = (wordPool as { items: Item[] }).items;

function readAsset(name: string): string {
  return readFileSync(join(ASSET_DIR, name), 'utf-8');
}

const assetNames = readdirSync(ASSET_DIR).filter((n) => n.endsWith('.svg'));

describe('단어이해·그림이름대기 그림 자산', () => {
  it('자산이 존재한다', () => {
    expect(assetNames.length).toBeGreaterThan(0);
  });

  // 가장 중요한 규칙. 그림 이름대기는 그림만 보고 이름을 말하는 검사인데,
  // 그림에 정답 단어가 인쇄돼 있으면 환자가 읽기만 해도 맞는다 —
  // 검사가 성립하지 않는다. 실제로 74개 전부가 그 상태였다.
  it('그림에 글자가 없다 (정답 노출 금지)', () => {
    const withText = assetNames.filter((n) => readAsset(n).includes('<text'));

    expect(withText).toEqual([]);
  });

  // 배경색이 항목마다 다르면 4지선다에서 배경 자체가 시각 단서가 된다.
  it('배경색이 전 항목 동일하다', () => {
    const backgrounds = new Set(
      assetNames.map((n) => {
        const m = readAsset(n).match(/<rect width="300" height="300" fill="(#[0-9A-Fa-f]{6})"/);
        return m?.[1] ?? 'NONE';
      }),
    );

    expect(backgrounds.size).toBe(1);
    expect(backgrounds.has('NONE')).toBe(false);
  });

  it('PLACEHOLDER 표시가 남아 있지 않다', () => {
    const placeholders = assetNames.filter((n) =>
      readAsset(n).includes('PLACEHOLDER'),
    );

    expect(placeholders).toEqual([]);
  });

  it('문항이 참조하는 그림이 모두 존재한다', () => {
    const referenced = new Set<string>();
    for (const item of items) {
      for (const choice of item.choices) {
        referenced.add(basename(choice.imageUrl));
      }
    }
    const missing = [...referenced].filter((n) => !assetNames.includes(n));

    expect(missing).toEqual([]);
  });

  // 같은 그림이 한 문항의 두 보기에 쓰이면 문항이 모호해진다.
  it('한 문항 안에서 같은 그림이 중복되지 않는다', () => {
    const dupes = items
      .filter((item) => {
        const urls = item.choices.map((c) => c.imageUrl);
        return new Set(urls).size !== urls.length;
      })
      .map((item) => item.itemId);

    expect(dupes).toEqual([]);
  });
});
