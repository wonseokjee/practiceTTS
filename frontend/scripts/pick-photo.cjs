/**
 * 검사 그림 후보를 Openverse에서 모아 고르기 화면으로 띄운다.
 *
 * 왜 필요한가: 고령·치매 환자는 도식적인 선화보다 실물 사진에 더 잘 반응한다.
 * 특히 그림 이름대기(산출 과제)에서 차이가 크다.
 *
 * 왜 자동 선택이 아닌가: "사과"를 검색하면 사과나무·사과주스·사과농장이 섞여
 * 나온다. 검사 그림은 **대상 하나가 명확히, 정면에 가깝게, 배경이 조용하게**
 * 나와야 한다. 그 판단은 사람이 해야 한다.
 *
 * 라이선스: commercial 필터를 걸어 상업적 이용이 허용된 것만 받는다.
 * 각 후보의 라이선스와 출처를 함께 기록해 나중에 근거를 추적할 수 있게 한다.
 *
 * 사용:
 *   cd frontend && node scripts/pick-photo.cjs <검색어> [슬러그]
 *   그다음 브라우저에서 http://localhost:5173/_candidates.html 을 연다.
 *
 * 검색어 요령(실측):
 *   "apple fruit whole"          -> 사과나무·건물 등 무관한 것이 섞인다
 *   "single red apple white bg"  -> 너무 좁아 1개만 나온다
 *   "apple white background"     -> 12개 전부 단일 대상·흰 배경·CC0. 이 형태가 좋다.
 *   즉 "<대상> white background" 가 균형점이다.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const query = process.argv[2];
const slug = process.argv[3] ?? 'candidate';
if (!query) {
  console.error('사용: node scripts/pick-photo.cjs <검색어> [슬러그]');
  process.exit(1);
}

const PAGE_SIZE = 12;
const API = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(
  query,
)}&license_type=commercial&page_size=${PAGE_SIZE}&mature=false`;

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'practiveTTS-dev' } }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      })
      .on('error', reject);
  });
}

(async () => {
  const data = JSON.parse(await get(API));
  const results = (data.results ?? []).map((r, i) => ({
    n: i + 1,
    id: r.id,
    title: r.title ?? '',
    url: r.url,
    thumbnail: r.thumbnail ?? r.url,
    license: `${r.license ?? ''} ${r.license_version ?? ''}`.trim(),
    creator: r.creator ?? '',
    source: r.foreign_landing_url ?? '',
  }));

  const outDir = path.join(process.cwd(), 'public');
  fs.writeFileSync(
    path.join(outDir, '_candidates.json'),
    JSON.stringify({ query, slug, results }, null, 2),
  );

  const cards = results
    .map(
      (r) => `
    <figure style="margin:0">
      <div style="position:relative">
        <img src="${r.thumbnail}" loading="lazy"
             style="width:100%;height:190px;object-fit:contain;background:#FAF9F7;border:1px solid #E8E4DC;border-radius:12px">
        <span style="position:absolute;top:6px;left:6px;background:#2D6A56;color:#fff;
                     font:700 14px sans-serif;padding:2px 9px;border-radius:999px">${r.n}</span>
      </div>
      <figcaption style="font:11px/1.4 sans-serif;color:#5C6661;margin-top:5px">
        ${r.title.slice(0, 44)}<br><span style="color:#9AA09B">${r.license}</span>
      </figcaption>
    </figure>`,
    )
    .join('');

  fs.writeFileSync(
    path.join(outDir, '_candidates.html'),
    `<html><body style="margin:0;padding:14px;background:#fff;font-family:sans-serif">
      <h2 style="margin:0 0 4px;font-size:16px">"${query}" 후보 ${results.length}개</h2>
      <p style="margin:0 0 12px;font-size:12px;color:#6B6560">
        대상 하나가 명확하고, 배경이 조용하고, 정면에 가까운 것을 고르세요. 번호로 알려주시면 됩니다.
      </p>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">${cards}</div>
    </body></html>`,
  );

  console.log(`후보 ${results.length}개 준비 — /_candidates.html`);
})();
