// redirect.mjs – после сборки (post-render) кладёт manual/index.html: короткий адрес методички на Pages
// (…/manual/ → собранная книга в book/). Сам Quarto такой файл удаляет как устаревший выход index.qmd.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(join(ROOT, "index.html"), `<!doctype html>
<!-- создаётся tools/redirect.mjs при каждой сборке – не править вручную -->
<html lang="ru">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=book/">
<link rel="canonical" href="book/">
<title>Нефтяша: методическое пособие</title>
</head>
<body>
<p>Пособие открывается… Если нет – <a href="book/">перейдите по ссылке</a>.</p>
</body>
</html>
`);
