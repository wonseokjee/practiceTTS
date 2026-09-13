import '@testing-library/jest-dom';
import { initI18n } from '../shared/i18n/i18n.js';

// 화면 문구가 i18n으로 옮겨가면(Phase 1-2) 컴포넌트 테스트마다 초기화된
// 인스턴스가 필요하다. 앱(main.tsx)과 같이 한국어로 한 번 초기화한다.
await initI18n('ko-KR');
