import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initI18n } from './shared/i18n/i18n.ts'

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// 활성 로케일의 문구를 받은 뒤에 그린다 — 화면이 키 문자열로 번쩍이지 않게.
// 받기에 실패해도 앱은 반드시 그린다: 번역 파일 하나 때문에 흰 화면이 되는
// 쪽이 훨씬 나쁘다(빠진 키는 i18n.ts의 경고로 드러난다).
initI18n()
  .catch((error: unknown) => {
    console.error('[i18n] init failed — continuing without translated strings', error)
  })
  .finally(render)
