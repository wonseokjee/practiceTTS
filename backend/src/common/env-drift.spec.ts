import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * .env.example이 코드와 어긋나는 것을 막는다.
 *
 * 배경: 백엔드가 `AI_SERVICE_URL`과 `FASTAPI_URL` 두 이름을 동시에 쓰고
 * 있었는데 .env.example에는 앞의 것만 있었다. 문서대로 설정하면 음성만
 * 살고 태깅·마스킹·퀴즈·대화가 전부 localhost 폴백으로 죽는다. 둘 다
 * 기본값이 있어서 **부팅은 성공하고 런타임에만 깨진다** — 원인 추적이
 * 오래 걸리는 최악의 실패 모드다.
 *
 * 감사해보니 그것만이 아니었다. CRYPTO_SECRET_KEY(가족 실명 암호화 키)를
 * 포함해 5개가 문서에 없었다. 사람이 기억하는 방식이 실패했으므로 기계가 막는다.
 */

const SRC_DIR = join(__dirname, '..');
const ENV_EXAMPLE = join(__dirname, '..', '..', '.env.example');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** 소스가 읽는 환경변수 이름을 모은다. */
function collectUsedVars(): Set<string> {
  const patterns = [
    /configService\.get<[^>]*>\(\s*'([A-Z_0-9]+)'/g,
    /configService\.get\(\s*'([A-Z_0-9]+)'/g,
    /process\.env\.([A-Z_0-9]+)/g,
    /process\.env\['([A-Z_0-9]+)'\]/g,
  ];
  const used = new Set<string>();
  for (const file of walk(SRC_DIR)) {
    const source = readFileSync(file, 'utf-8');
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) used.add(match[1]);
    }
  }
  return used;
}

/** .env.example이 선언한 이름을 모은다. */
function collectDeclaredVars(): Set<string> {
  return new Set(
    readFileSync(ENV_EXAMPLE, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => line.split('=')[0].trim()),
  );
}

describe('환경변수 드리프트', () => {
  it('코드가 읽는 환경변수가 모두 .env.example에 있다', () => {
    const used = collectUsedVars();
    const declared = collectDeclaredVars();

    const missing = [...used].filter((name) => !declared.has(name)).sort();

    expect(missing).toEqual([]);
  });

  it('.env.example에 코드가 안 쓰는 값이 없다', () => {
    // 잉여 항목은 "설정했는데 아무 일도 안 일어나는" 혼란을 만든다.
    // ai-service의 .env.example에 남아 있던 OPENAI_API_KEY가 그런 예다.
    const used = collectUsedVars();
    const declared = collectDeclaredVars();

    const unused = [...declared].filter((name) => !used.has(name)).sort();

    expect(unused).toEqual([]);
  });

  it('ai-service 주소를 가리키는 이름이 하나뿐이다', () => {
    // 두 이름이 공존하면 하나만 설정했을 때 절반의 기능이 조용히 죽는다.
    const used = collectUsedVars();

    expect(used.has('AI_SERVICE_URL')).toBe(true);
    expect(used.has('FASTAPI_URL')).toBe(false);
  });
});
