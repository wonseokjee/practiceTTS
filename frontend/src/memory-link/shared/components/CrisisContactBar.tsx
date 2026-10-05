// 위기 연결처 줄 — 보호자가 속마음을 쓰는 화면의 하단 고정.
//
// 일기 '나의 하루'(보호자 자유 입력, LLM 미전달)에 먼저 붙이고, 선배 보호자 도우미의
// 공통 틀이 같은 컴포넌트를 쓴다(TODOS `diary-crisis-footer`, 엔지니어링 리뷰 OV-2).
//
// 디자인 리뷰(2026-10-05) 결정 12:
// - 중립 흰색 + line 윗선. 보호자 영역(테라코타)·크림 어느 배경에서도 같은 모양이어야 한다.
//   크고 붉으면 "당신 위험하죠?"로 읽힌다.
// - 화면 틀의 고정 하단, 높이 56px. 같은 높이의 빈 자리를 흐름 안에 두어 마지막 내용을
//   가리지 않는다 — 그래서 이 컴포넌트는 **페이지의 맨 끝**에 놓는다.
// - 번호는 tel: 링크, 터치 영역 44px. 긴 목록은 '더보기' 시트.
// - 터치 기기에서 글 입력 칸에 포커스가 가면(=화면 키보드) 숨긴다. 키보드 위로 떠서
//   입력을 가리지 않게.
//
// 입력을 읽거나 판정하지 않는다. 서버로 아무것도 보내지 않는다 — 위험 문장에 맞춘
// 안내(규칙 판정)는 TODOS `crisis-eval-set` 이후의 일이다.

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_LOCALE } from '../../../shared/domain/locale.js';
import { crisisContactsFor, type CrisisContact } from '../crisisContacts.js';
import { PhoneIcon } from './LineIcons.js';

const TEXT_INPUT_EXCLUDED = new Set([
  'button',
  'checkbox',
  'radio',
  'submit',
  'reset',
  'range',
  'file',
  'color',
]);

function isTextField(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && !TEXT_INPUT_EXCLUDED.has(el.type);
}

/** 터치 기기에서 글 입력 칸에 포커스가 있는가 — 화면 키보드가 올라온 상태로 본다. */
function useSoftKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const coarse =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    if (!coarse) return;
    const onIn = (e: FocusEvent): void => setOpen(isTextField(e.target));
    const onOut = (): void => setOpen(false);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return open;
}

export function CrisisContactBar() {
  const { t, i18n } = useTranslation('caregiver');
  const contacts = crisisContactsFor(i18n.resolvedLanguage ?? DEFAULT_LOCALE);
  const keyboardOpen = useSoftKeyboardOpen();
  const [sheetOpen, setSheetOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);

  if (!contacts) return null;

  const closeSheet = (): void => {
    setSheetOpen(false);
    moreRef.current?.focus();
  };

  return (
    <>
      <div aria-hidden="true" className="h-14" />
      {!keyboardOpen && (
        <aside
          aria-label={t('crisisBar.aria')}
          className="font-pretendard fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white"
        >
          <div className="mx-auto flex h-14 max-w-2xl items-center gap-1.5 px-2.5">
            <p className="flex-1 text-xs leading-tight text-muted-sage">
              {t('crisisBar.lead')}
            </p>
            {contacts.primary.map((c) => (
              <ContactChip key={c.id} contact={c} />
            ))}
            <button
              ref={moreRef}
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-haspopup="dialog"
              aria-label={t('crisisBar.moreAria')}
              className="min-h-[44px] px-1.5 text-xs text-muted-sage transition-colors duration-[180ms] ease-out hover:text-ink-sage"
            >
              {t('crisisBar.more')}
            </button>
          </div>
        </aside>
      )}
      {sheetOpen && (
        <CrisisContactSheet all={contacts.all} onClose={closeSheet} />
      )}
    </>
  );
}

function ContactChip({ contact }: { contact: CrisisContact }) {
  const { t } = useTranslation('caregiver');
  return (
    <a
      href={`tel:${contact.tel}`}
      aria-label={t('crisisBar.callAria', {
        label: t(`crisisBar.contact.${contact.id}`),
        number: contact.display,
      })}
      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-line-strong bg-white px-2.5 text-sm font-semibold tabular-nums text-ink-sage transition-colors duration-[180ms] ease-out hover:bg-canvas"
    >
      <PhoneIcon size={14} />
      {contact.display}
    </a>
  );
}

interface SheetProps {
  all: readonly CrisisContact[];
  onClose: () => void;
}

function CrisisContactSheet({ all, onClose }: SheetProps) {
  const { t } = useTranslation('caregiver');
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="font-pretendard fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="crisis-sheet-title"
        className="w-full max-w-2xl rounded-t-3xl bg-white px-6 pb-8 pt-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="crisis-sheet-title"
          ref={titleRef}
          tabIndex={-1}
          className="text-lg font-semibold text-ink-sage focus:outline-none"
        >
          {t('crisisBar.sheetTitle')}
        </h2>
        <ul className="mt-3">
          {all.map((c) => (
            <li key={c.id} className="border-b border-line">
              <a
                href={`tel:${c.tel}`}
                className="flex min-h-[56px] items-center justify-between gap-3 text-base text-ink-sage"
              >
                <span>{t(`crisisBar.contact.${c.id}`)}</span>
                <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-primary-dark">
                  <PhoneIcon size={16} />
                  {c.display}
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-muted-sage">
          {t('crisisBar.sheetNote')}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 min-h-[48px] w-full rounded-full bg-canvas text-sm font-medium text-ink-sage transition-colors duration-[180ms] ease-out hover:bg-canvas-hover"
        >
          {t('crisisBar.close')}
        </button>
      </div>
    </div>
  );
}
