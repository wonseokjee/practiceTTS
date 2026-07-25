/**
 * 검사 그림 임시 저장 서버.
 *
 * 왜 필요한가: 브라우저 Canvas가 사진을 300×300 PNG로 다듬는데, 브라우저
 * 다운로드는 파일이 Downloads로 흩어져 프로젝트로 옮기기 번거롭다. 이 서버가
 * Canvas가 보낸 PNG 바이트를 지정 경로에 바로 쓴다.
 *
 * Node에 이미지 라이브러리(sharp/jimp)가 없어서 디코딩·리사이즈는 브라우저가
 * 하고, 서버는 완성된 바이트만 파일로 쓴다. 역할이 깔끔하게 갈린다.
 *
 * 사용:  node scripts/save-server.cjs
 *        브라우저 처리 페이지의 "서버 저장" 버튼이 여기로 POST한다.
 *        작업이 끝나면 Ctrl+C.
 *
 * 보안: 로컬 개발 전용. dir는 화이트리스트 안에서만, slug는 영문/숫자만
 *       허용해 경로 탈출을 막는다.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5178;
const ROOT = path.join(process.cwd(), 'public', 'assets', 'images');
const ALLOWED_DIRS = new Set(['naming', 'wordComp', 'sentComp']);

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/save') {
    res.writeHead(404).end('not found');
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const { dir, slug, dataUrl, meta } = JSON.parse(body);
      if (!ALLOWED_DIRS.has(dir)) throw new Error(`허용되지 않은 디렉토리: ${dir}`);
      if (!/^[a-z0-9_]+$/.test(slug)) throw new Error(`잘못된 slug: ${slug}`);
      const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl ?? '');
      if (!m) throw new Error('PNG data URL이 아님');

      const outDir = path.join(ROOT, dir);
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `${slug}.png`);
      fs.writeFileSync(outPath, Buffer.from(m[1], 'base64'));

      // 라이선스·출처를 함께 기록한다. 나중에 근거를 물으면 답할 수 있어야 한다.
      if (meta) {
        const creditsPath = path.join(outDir, '_credits.json');
        let credits = [];
        try {
          credits = JSON.parse(fs.readFileSync(creditsPath, 'utf-8'));
        } catch {
          /* 첫 저장 */
        }
        credits = credits.filter((x) => x.slug !== slug);
        credits.push({
          slug,
          ko: meta.ko ?? '',
          title: meta.title ?? '',
          license: meta.license ?? '',
          source: meta.source ?? '',
          savedAt: new Date().toISOString().slice(0, 10),
        });
        credits.sort((a, b) => a.slug.localeCompare(b.slug));
        fs.writeFileSync(creditsPath, JSON.stringify(credits, null, 2) + '\n');
      }

      // 이름대기 사진은 보유 목록에도 등록한다. toNamingItem이 이 목록을
      // 보고 사진/SVG를 고르므로, 저장과 등록을 한 번에 끝내야 빠뜨리지 않는다.
      if (dir === 'naming') {
        const listPath = path.join(
          process.cwd(),
          'src',
          'assets',
          'data',
          'namingPhotos.json',
        );
        const list = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
        if (!list.slugs.includes(slug)) {
          list.slugs = [...list.slugs, slug].sort();
          fs.writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n');
          console.log(`  목록 등록: ${slug} (총 ${list.slugs.length}개)`);
        }
      }

      const rel = path.relative(process.cwd(), outPath);
      console.log(`저장: ${rel} (${fs.statSync(outPath).size} bytes)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: `/assets/images/${dir}/${slug}.png` }));
    } catch (err) {
      console.error('저장 실패:', err.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`검사 그림 저장 서버 → http://localhost:${PORT}/save`);
  console.log(`저장 위치: ${ROOT}\\<dir>\\<slug>.png`);
});
