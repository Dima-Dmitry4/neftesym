// Встраивает vendor/plotly-cartesian.min.js в index.html (между маркерами plotly:start / plotly:end),
// чтобы игра оставалась одним автономным файлом, который можно пересылать. Запускать из корня репозитория
// после обновления файла в vendor/.
import { readFileSync, writeFileSync } from "fs";
const html = readFileSync("index.html", "utf8"), plotly = readFileSync("vendor/plotly-cartesian.min.js", "utf8");
if (plotly.includes("</script")) throw new Error("plotly содержит </script> – нельзя встраивать в HTML");
const block = `<!-- plotly:start – сгенерировано tools/embed-plotly.mjs из vendor/plotly-cartesian.min.js (не править вручную) -->\n<script id="plotly-lib">\n${plotly}\n</script>\n<!-- plotly:end -->`;
const re = /(<script src="vendor\/plotly-cartesian\.min\.js"><\/script>|<!-- plotly:start[\s\S]*?<!-- plotly:end -->)/;
if (!re.test(html)) throw new Error("не найден блок plotly в index.html");
writeFileSync("index.html", html.replace(re, () => block)); // функция-замена: $-шаблоны внутри Plotly не интерпретируются
console.log(`plotly встроен: ${(plotly.length / 1e6).toFixed(2)} МБ; index.html ${((html.length - (html.match(re)[0].length) + block.length) / 1e6).toFixed(2)} МБ`);
