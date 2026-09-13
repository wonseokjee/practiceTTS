import '@testing-library/jest-dom';
import { DEFAULT_LOCALE } from '../shared/domain/locale.js';
import { initI18n } from '../shared/i18n/i18n.js';

// 화면 문구가 i18n으로 옮겨가면(Phase 1-2) 컴포넌트 테스트마다 초기화된
// 인스턴스가 필요하다. 앱(main.tsx)과 같이 기본 로케일로 한 번 초기화한다.
// 로케일을 문자열로 적지 않는다 — locale.test.ts의 단일 출처 검사 대상이다
// (이 파일은 .test가 아니라서 검사에 걸린다).
await initI18n(DEFAULT_LOCALE);
