/**
 * 이름대기 대상 74개 단어의 사진 후보를 한 번에 수집한다.
 *
 * 왜 한 번에: 74개를 한 단어씩 검색·확인하면 반복이 너무 많다. 후보를
 * 미리 모아 한 화면에 펼치면, 각 단어당 마음에 드는 번호만 쭉 고르면 된다.
 *
 * slug(영문 파일명)를 검색어로 쓴다. "<slug> white background isolated"가
 * 단일 대상·조용한 배경 후보를 안정적으로 준다(실측).
 *
 * 결과: public/_all-candidates.json — 단어별 후보 6개씩.
 *        Openverse rate limit을 피하려고 요청 간 간격을 둔다.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const pool = require('../src/assets/data/qabWordPool.json');

// 정답 그림 slug만 (이름대기가 실제 쓰는 것), 사과 제외
const seen = new Set(['apple']);
const targets = [];
for (const it of pool.items) {
  const c = it.choices.find((x) => x.isCorrect);
  const slug = c.imageUrl.split('/').pop().replace('.svg', '');
  if (!seen.has(slug)) {
    seen.add(slug);
    targets.push({ ko: it.targetWord, slug });
  }
}

// 추상적이라 "isolated white background"가 안 통하는 단어는 검색어를 손본다.
const QUERY_OVERRIDES = {
  // rawpixel은 태그가 짧아 단순어가 더 잘 맞는다. 건물류는 rawpixel에
  // 흰 배경 컷아웃이 드물어 그대로도 애매할 수 있다(폴백 대상 후보).
  spine: 'spine anatomy',
  sweet_potato: 'sweet potato',
  rice_cooker: 'rice cooker',
  washing_machine: 'washing machine',
};

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// rawpixel만 쓰면 같은 제품컷이 반복돼 다양성이 없다. 소스를 나눠 각각
// 조회한 뒤 번갈아 섞으면(rawpixel=깔끔한 컷, wikimedia/stocksnap/flickr=실사진)
// 단어당 서로 다른 종류의 후보가 모인다. 소스별로 따로 요청해야 특정 소스가
// 순위를 독식하지 않는다.
const SOURCES = ['rawpixel', 'wikimedia', 'stocksnap', 'flickr'];

function apiUrl(query, source, size) {
  return (
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}` +
    `&source=${source}&license_type=commercial&page_size=${size}&mature=false`
  );
}

function mapResults(data) {
  return (data.results ?? []).map((r) => ({
    url: r.thumbnail ?? r.url,
    full: r.url,
    title: (r.title ?? '').slice(0, 40),
    license: `${r.license ?? ''} ${r.license_version ?? ''}`.trim(),
    source: r.foreign_landing_url ?? '',
  }));
}

// 여러 리스트를 라운드로빈으로 섞어 소스가 골고루 섞이게, 썸네일 URL로 중복 제거
function interleave(lists) {
  const merged = [];
  const seen = new Set();
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i += 1) {
    for (const list of lists) {
      const r = list[i];
      if (!r || seen.has(r.url)) continue;
      seen.add(r.url);
      merged.push(r);
    }
  }
  return merged;
}

(async () => {
  const out = {};
  for (let i = 0; i < targets.length; i += 1) {
    const { ko, slug } = targets[i];
    const query = QUERY_OVERRIDES[slug] ?? slug.replace(/_/g, ' ');
    const perSource = [];
    for (const src of SOURCES) {
      try {
        const data = JSON.parse(await get(apiUrl(query, src, 8)));
        perSource.push(mapResults(data));
      } catch (e) {
        perSource.push([]);
      }
      await sleep(300); // rate limit 여유
    }
    out[slug] = { ko, query, results: interleave(perSource) };
    process.stdout.write(
      `\r[${i + 1}/${targets.length}] ${ko} — ${out[slug].results.length}개   `,
    );
  }

  fs.writeFileSync(
    path.join(process.cwd(), 'public', '_all-candidates.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(`\n완료 — public/_all-candidates.json (${targets.length}개 단어)`);
})();
