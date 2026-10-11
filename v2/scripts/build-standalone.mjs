// Сборка single-file HTML из dist/.
//
// Vite по умолчанию делает:
//   dist/index.html               — точка входа (ссылается на /assets/*.js,*.css)
//   dist/assets/index-*.js         — приложение
//   dist/assets/index-*.css       — стили
//   dist/favicon.svg              — иконка
//
// Скрипт читает эти файлы и собирает один self-contained HTML,
// который открывается локально без dev-сервера и без npm.
//
// Использование:
//   npm run build              # tsc --noEmit && vite build
//   node scripts/build-standalone.mjs
// или
//   npm run standalone         # build + standalone

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');
const assetsDir = resolve(distDir, 'assets');
const outDir = resolve(root, 'standalone');
const outFile = resolve(outDir, 'oilgame.html');

async function main() {
  // 1. dist/index.html
  const indexHtml = await readFile(resolve(distDir, 'index.html'), 'utf8');

  // 2. JS
  const jsTagRe = /<script\s+type="module"[^>]*src="([^"]+)"[^>]*>\s*<\/script>/i;
  const jsMatch = indexHtml.match(jsTagRe);
  if (!jsMatch) throw new Error('Не нашёл <script src=...> в dist/index.html');
  const jsName = basename(jsMatch[1]);
  const jsContent = await readFile(resolve(assetsDir, jsName), 'utf8');

  // 3. CSS
  const cssTagRe = /<link\s+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/i;
  const cssMatch = indexHtml.match(cssTagRe);
  if (!cssMatch) throw new Error('Не нашёл <link rel=stylesheet href=...>');
  const cssName = basename(cssMatch[1]);
  const cssContent = await readFile(resolve(assetsDir, cssName), 'utf8');

  // 4. Favicon → data URL
  const favTagRe = /<link\s+rel="icon"[^>]*href="([^"]+)"[^>]*>/i;
  const favMatch = indexHtml.match(favTagRe);
  let faviconReplacement = '';
  if (favMatch) {
    const favName = basename(favMatch[1]);
    try {
      const favContent = await readFile(resolve(distDir, favName), 'utf8');
      const dataUrl =
        'data:image/svg+xml;base64,' +
        Buffer.from(favContent, 'utf8').toString('base64');
      faviconReplacement = `<link rel="icon" type="image/svg+xml" href="${dataUrl}">`;
    } catch {
      // нет favicon — оставляем ссылку как есть
    }
  }

  // 5. Собираем HTML
  // - убираем ссылку на CSS, заменяем на инлайн <style>
  // - убираем ссылку на JS, заменяем на инлайн <script type="module">
  // - favicon → data URL
  // Vite в собранном HTML добавляет атрибут crossorigin на <script> и <link> —
  // для локального открытия он не нужен и может помешать в некоторых браузерах,
  // если файл открыт через file://. Удаляем crossorigin у <script type="module">,
  // потому что data: и blob: под file:// работают только без crossorigin.
  let result = indexHtml;

  result = result.replace(
    cssTagRe,
    `<style>${cssContent}</style>`,
  );
  result = result.replace(
    jsTagRe,
    `<script type="module">\n${jsContent}\n</script>`,
  );
  if (faviconReplacement) {
    result = result.replace(favTagRe, faviconReplacement);
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(outFile, result, 'utf8');

  const sizeKb = (statSync(outFile).size / 1024).toFixed(1);
  console.log(`✓ Standalone HTML: ${outFile}`);
  console.log(`  size: ${sizeKb} KB`);
  console.log(`  open: file:///${outFile.replace(/\\/g, '/')}`);
}

main().catch((err) => {
  console.error('Standalone build failed:', err);
  process.exit(1);
});