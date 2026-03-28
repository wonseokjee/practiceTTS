/**
 * WordComp 플레이스홀더 이미지 생성기
 *
 * 74개의 WebP 이미지를 SVG 기반 플레이스홀더로 생성한다.
 * 실제 일러스트 이미지가 준비되면 이 파일들을 교체한다.
 *
 * 실행: node scripts/generate-wordcomp-placeholders.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '../frontend/public/assets/images/wordComp');

// 파일명 → { emoji, label, bg } 매핑
const IMAGE_MAP = {
  airplane:       { emoji: '✈️', label: '비행기', bg: '#E3F2FD' },
  apple:          { emoji: '🍎', label: '사과',   bg: '#FFEBEE' },
  bag:            { emoji: '👜', label: '가방',   bg: '#FFF8E1' },
  balloon:        { emoji: '🎈', label: '풍선',   bg: '#FCE4EC' },
  banana:         { emoji: '🍌', label: '바나나', bg: '#FFFDE7' },
  basket:         { emoji: '🧺', label: '바구니', bg: '#F3E5F5' },
  bed:            { emoji: '🛏️', label: '침대',   bg: '#E8EAF6' },
  bicycle:        { emoji: '🚲', label: '자전거', bg: '#E0F2F1' },
  blanket:        { emoji: '🛌', label: '이불',   bg: '#F3E5F5' },
  book:           { emoji: '📚', label: '책',     bg: '#FFF3E0' },
  bread:          { emoji: '🍞', label: '식빵',   bg: '#FFFDE7' },
  bus:            { emoji: '🚌', label: '버스',   bg: '#E3F2FD' },
  butterfly:      { emoji: '🦋', label: '나비',   bg: '#FCE4EC' },
  candy:          { emoji: '🍬', label: '사탕',   bg: '#FCE4EC' },
  car:            { emoji: '🚗', label: '자동차', bg: '#E3F2FD' },
  cat:            { emoji: '🐱', label: '고양이', bg: '#FFF8E1' },
  chair:          { emoji: '🪑', label: '의자',   bg: '#F3E5F5' },
  chick:          { emoji: '🐥', label: '병아리', bg: '#FFFDE7' },
  comb:           { emoji: '🪮', label: '빗',     bg: '#E8EAF6' },
  computer:       { emoji: '💻', label: '컴퓨터', bg: '#E3F2FD' },
  desk:           { emoji: '🖥️', label: '책상',   bg: '#F3E5F5' },
  dog:            { emoji: '🐶', label: '강아지', bg: '#FFF8E1' },
  elephant:       { emoji: '🐘', label: '코끼리', bg: '#ECEFF1' },
  flower:         { emoji: '🌸', label: '꽃',     bg: '#FCE4EC' },
  gloves:         { emoji: '🧤', label: '장갑',   bg: '#E8F5E9' },
  grape:          { emoji: '🍇', label: '포도',   bg: '#EDE7F6' },
  guitar:         { emoji: '🎸', label: '기타',   bg: '#FFF8E1' },
  hammer:         { emoji: '🔨', label: '망치',   bg: '#EFEBE9' },
  hat:            { emoji: '🎩', label: '모자',   bg: '#E8EAF6' },
  hospital:       { emoji: '🏥', label: '병원',   bg: '#FFEBEE' },
  juice:          { emoji: '🧃', label: '주스',   bg: '#FFF9C4' },
  knife:          { emoji: '🔪', label: '칼',     bg: '#FAFAFA' },
  ladder:         { emoji: '🪜', label: '사다리', bg: '#E8EAF6' },
  ladle:          { emoji: '🥄', label: '국자',   bg: '#FFF8E1' },
  library:        { emoji: '📖', label: '도서관', bg: '#E3F2FD' },
  lion:           { emoji: '🦁', label: '사자',   bg: '#FFF8E1' },
  mailbox:        { emoji: '📮', label: '우체통', bg: '#FFEBEE' },
  melon:          { emoji: '🍈', label: '참외',   bg: '#F9FBE7' },
  milk:           { emoji: '🥛', label: '우유',   bg: '#FAFAFA' },
  mirror:         { emoji: '🪞', label: '거울',   bg: '#E3F2FD' },
  notebook:       { emoji: '📓', label: '공책',   bg: '#E8F5E9' },
  pear:           { emoji: '🍐', label: '배',     bg: '#F9FBE7' },
  pencil:         { emoji: '✏️', label: '연필',   bg: '#FFFDE7' },
  pharmacy:       { emoji: '💊', label: '약국',   bg: '#E8F5E9' },
  phone:          { emoji: '📱', label: '전화기', bg: '#E3F2FD' },
  piano:          { emoji: '🎹', label: '피아노', bg: '#ECEFF1' },
  pool:           { emoji: '🏊', label: '수영장', bg: '#E3F2FD' },
  pot:            { emoji: '🪣', label: '냄비',   bg: '#EFEBE9' },
  refrigerator:   { emoji: '🧊', label: '냉장고', bg: '#E3F2FD' },
  rice_cooker:    { emoji: '🍚', label: '밥솥',   bg: '#FAFAFA' },
  sand:           { emoji: '🏖️', label: '모래',   bg: '#FFF9C4' },
  school:         { emoji: '🏫', label: '학교',   bg: '#E8F5E9' },
  scissors:       { emoji: '✂️', label: '가위',   bg: '#E3F2FD' },
  ship:           { emoji: '🚢', label: '배(선박)', bg: '#E3F2FD' },
  shoes:          { emoji: '👟', label: '신발',   bg: '#FFF8E1' },
  soap:           { emoji: '🧼', label: '비누',   bg: '#E3F2FD' },
  socks:          { emoji: '🧦', label: '양말',   bg: '#FFF8E1' },
  spine:          { emoji: '🦴', label: '척추',   bg: '#FAFAFA' },
  strawberry:     { emoji: '🍓', label: '딸기',   bg: '#FFEBEE' },
  student:        { emoji: '🎒', label: '학생',   bg: '#E8F5E9' },
  sweet_potato:   { emoji: '🍠', label: '고구마', bg: '#FFF8E1' },
  tiger:          { emoji: '🐯', label: '호랑이', bg: '#FFF8E1' },
  tomato:         { emoji: '🍅', label: '토마토', bg: '#FFEBEE' },
  toothbrush:     { emoji: '🪥', label: '칫솔',   bg: '#E3F2FD' },
  toothpaste:     { emoji: '🦷', label: '치약',   bg: '#E3F2FD' },
  towel:          { emoji: '🏳️', label: '수건',   bg: '#F3E5F5' },
  train:          { emoji: '🚂', label: '기차',   bg: '#E3F2FD' },
  tree:           { emoji: '🌳', label: '나무',   bg: '#E8F5E9' },
  trumpet:        { emoji: '🎺', label: '트럼펫', bg: '#FFF8E1' },
  turtle:         { emoji: '🐢', label: '거북이', bg: '#E8F5E9' },
  umbrella:       { emoji: '☂️', label: '우산',   bg: '#E3F2FD' },
  washing_machine:{ emoji: '🫧', label: '세탁기', bg: '#E3F2FD' },
  watermelon:     { emoji: '🍉', label: '수박',   bg: '#E8F5E9' },
  whale:          { emoji: '🐋', label: '고래',   bg: '#E3F2FD' },
};

function makeSvg({ emoji, label, bg }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">
  <rect width="300" height="300" fill="${bg}" rx="16"/>
  <text x="150" y="155" font-size="110" text-anchor="middle" dominant-baseline="middle" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">${emoji}</text>
  <text x="150" y="255" font-size="28" text-anchor="middle" fill="#37474F" font-family="Pretendard, Noto Sans KR, sans-serif" font-weight="600">${label}</text>
  <!-- PLACEHOLDER: 실제 일러스트로 교체 필요 -->
</svg>`;
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

let count = 0;
for (const [name, meta] of Object.entries(IMAGE_MAP)) {
  // .webp 확장자로 SVG 내용 저장 (브라우저는 MIME이 아닌 내용으로 렌더링)
  // 실제로는 .svg로 저장하고 JSON 경로를 업데이트하는 것이 더 정확하지만
  // 기존 JSON 참조를 유지하기 위해 SVG 내용을 .webp 이름으로 저장
  // ※ 실제 배포 전 반드시 진짜 이미지로 교체할 것
  const svgPath = path.join(OUTPUT_DIR, `${name}.svg`);
  fs.writeFileSync(svgPath, makeSvg(meta), 'utf-8');
  count++;
}

console.log(`✅ ${count}개 SVG 플레이스홀더 생성 완료`);
console.log(`📁 위치: ${OUTPUT_DIR}`);
console.log('⚠️  실제 배포 전 진짜 일러스트 이미지로 교체하세요.');
