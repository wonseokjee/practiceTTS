// 문자열 추출(영어판 Phase 1-2) — 옮긴 곳이 되돌아가지 않게, 두 언어 파일이 어긋나지 않게
//
// 검증 포인트:
//  - 추출을 마친 디렉터리에는 주석 밖 한글이 없다(새 문구가 다시 박히면 잡힌다)
//  - 네임스페이스마다 한국어·영어 키 집합이 같다(복수형 접미는 규약 2대로)
//
// 추출 PR마다 EXTRACTED_DIRS에 디렉터리를 하나씩 더한다(계획서 §4 1-2: 디렉터리 하나 = 커밋 하나).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** 문구를 i18n 키로 옮긴 디렉터리(src 기준). 하위 디렉터리는 따로 적는다. */
const EXTRACTED_DIRS = [
  'memory-link/patient/quiz/presentation',
  'memory-link/patient/quiz/presentation/components',
  'memory-link/patient/presentation',
  'memory-link/shared/components',
  'memory-link/caregiver/presentation/components',
  'memory-link/caregiver/presentation',
  'assessments/sentComp/presentation/components',
  'shared/hub',
  'memory-link/patient/practice/presentation',
];

/**
 * 문구를 옮긴 개별 파일(디렉터리 단위로 못 더하는 경우) — `memory-link/shared`는
 * 로그인·온보딩 같은 화면과 `honorific.ts`(계획서 §6-3)·`QabOutbox.ts`(개발자
 * 로그)·`AuthContext.tsx`(개발용 자동 로그인 가짜 계정 — 실제 사용자에게 보이지
 * 않는다) 같은 한국어 전용 도메인/인프라 파일이 한 디렉터리에 섞여 있어, 디렉터리
 * 전체를 더하면 아직 손대지 않은 파일까지 걸린다.
 *
 * `patient/infrastructure`·`patient/quiz/infrastructure`도 마찬가지 —
 * `QabItemBank.ts`·`QabSpeechBank.ts`(발화 뱅크 데이터)·`QuizApi.ts`·
 * `TrainingSessionApi.ts`는 이번 배치(음성 인식 실패 메시지) 범위 밖이라
 * 손대지 않았다.
 */
const EXTRACTED_FILES = [
  'memory-link/shared/LoginScreen.tsx',
  'memory-link/shared/OnboardingScreen.tsx',
  'memory-link/shared/ReturnToCaregiverPinModal.tsx',
  'memory-link/shared/SocialCallbackScreen.tsx',
  'memory-link/shared/dailyLimit.ts',
  'memory-link/shared/extractErrorMessage.ts',
  'memory-link/shared/SettingsApi.ts',
  'memory-link/shared/HealingMessageApi.ts',
  'memory-link/patient/infrastructure/SttService.ts',
  'memory-link/patient/quiz/infrastructure/ServerSttService.ts',
  'memory-link/patient/quiz/infrastructure/SpeechCaptureService.ts',
];

const SRC = join(process.cwd(), 'src');
const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;

/** 주석은 번역 대상이 아니다(계획서 1-2) — 결정의 근거를 한국어로 남기는 자리다. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

const resources = import.meta.glob<Record<string, unknown>>('./locales/*/*.json', {
  eager: true,
  import: 'default',
});

function flatKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? flatKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

const PLURAL = /_(zero|one|two|few|many|other)$/;

describe('문자열 추출 (Phase 1-2)', () => {
  it('추출한 디렉터리에는 주석 밖 한글이 없다', () => {
    const offenders: string[] = [];
    for (const dir of EXTRACTED_DIRS) {
      for (const name of readdirSync(join(SRC, dir))) {
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        const code = stripComments(readFileSync(join(SRC, dir, name), 'utf-8'));
        code.split('\n').forEach((line, i) => {
          if (HANGUL.test(line)) offenders.push(`${dir}/${name}:${i + 1} ${line.trim()}`);
        });
      }
    }
    for (const path of EXTRACTED_FILES) {
      const code = stripComments(readFileSync(join(SRC, path), 'utf-8'));
      code.split('\n').forEach((line, i) => {
        if (HANGUL.test(line)) offenders.push(`${path}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('네임스페이스마다 한국어와 영어의 키가 같다', () => {
    const byNs = new Map<string, Map<string, string[]>>();
    for (const [path, json] of Object.entries(resources)) {
      const [, , locale, file] = path.split('/');
      const ns = file.replace(/\.json$/, '');
      if (!byNs.has(ns)) byNs.set(ns, new Map());
      byNs.get(ns)!.set(locale, flatKeys(json));
    }
    for (const [ns, locales] of byNs) {
      const ko = locales.get('ko-KR') ?? [];
      const en = locales.get('en-US') ?? [];
      const base = (keys: string[]) => [...new Set(keys.map((k) => k.replace(PLURAL, '')))].sort();
      expect(base(en), `${ns}: 영어에만/한국어에만 있는 키`).toEqual(base(ko));

      // 규약 2 — 한국어 복수형은 _other 하나, 영어는 _one과 _other가 짝.
      for (const k of ko.filter((k) => PLURAL.test(k))) {
        expect(k, `${ns}: 한국어 복수형은 _other만`).toMatch(/_other$/);
      }
      for (const k of en.filter((k) => /_other$/.test(k))) {
        expect(en, `${ns}: ${k}의 _one이 없다`).toContain(k.replace(/_other$/, '_one'));
      }
    }
  });
});
