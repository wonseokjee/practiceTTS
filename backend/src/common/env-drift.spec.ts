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

/**
 * 한 파일이 읽는 환경변수 이름을 뽑는다.
 *
 * `.get(` 앞의 수신자 이름은 보지 않는다. 예전에는 `configService.`로 시작하는
 * 것만 셌는데, ConfigService를 `config`라는 이름으로 주입한 파일 하나 때문에
 * SPEECH_DATA_DIR·SPEECH_DATA_MAX_PER_PATIENT가 "안 쓰는 값"으로 잡혔다.
 * 주입 변수명은 아무도 강제하지 않으므로 거기에 기대면 안 된다.
 *
 * 놓치는 쪽(과소 수집)이 훨씬 위험하다 — 코드가 읽는데 .env.example에 없는
 * 변수를 못 잡게 되고, 그게 이 테스트를 만든 이유(CRYPTO_SECRET_KEY 누락)다.
 * 반대로 과다 수집은 잉여 항목 검사에서 하나를 놓치는 정도로 끝난다. 그래서
 * 수신자를 넓게 잡는다. 키가 SCREAMING_SNAKE인 Map 조회 같은 오검출은
 * 감수한다(현재 백엔드에는 없다).
 */
export function extractEnvNames(source: string): string[] {
  const patterns = [
    /\.get(?:<[^>]*>)?\(\s*'([A-Z][A-Z_0-9]*)'/g,
    /process\.env\.([A-Z][A-Z_0-9]*)/g,
    /process\.env\['([A-Z][A-Z_0-9]*)'\]/g,
  ];
  const found = new Set<string>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) found.add(match[1]);
  }
  return [...found];
}

/** 소스가 읽는 환경변수 이름을 모은다. */
function collectUsedVars(): Set<string> {
  const used = new Set<string>();
  for (const file of walk(SRC_DIR)) {
    for (const name of extractEnvNames(readFileSync(file, 'utf-8'))) {
      used.add(name);
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

  it('ConfigService를 어떤 이름으로 주입했든 읽는 값을 잡아낸다', () => {
    // 수신자 이름에 기대던 시절 놓쳤던 실제 코드 모양이다.
    expect(
      extractEnvNames(
        `config.get<string>('SPEECH_DATA_DIR', '../speech-data')`,
      ),
    ).toEqual(['SPEECH_DATA_DIR']);
    expect(
      extractEnvNames(
        `this.configService.get<string>('CRYPTO_SECRET_KEY', '')`,
      ),
    ).toEqual(['CRYPTO_SECRET_KEY']);
    expect(extractEnvNames(`process.env.NODE_ENV`)).toEqual(['NODE_ENV']);
  });

  it('ai-service 주소를 가리키는 이름이 하나뿐이다', () => {
    // 두 이름이 공존하면 하나만 설정했을 때 절반의 기능이 조용히 죽는다.
    const used = collectUsedVars();

    expect(used.has('AI_SERVICE_URL')).toBe(true);
    expect(used.has('FASTAPI_URL')).toBe(false);
  });
});
