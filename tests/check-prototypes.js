// Проверка реестра прототипов (prototypes.js).
//
// Гарантирует, что корневое меню не сломается: у каждой записи есть id,
// title, path, статус из допустимого набора, теги — массив, id уникальны,
// а файл по path реально существует на диске.
//
// Запуск: node tests/check-prototypes.js
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const STATUSES = ["готов", "в работе", "черновик", "идея"];

const results = [];
function check(name, pass, details) {
  results.push({ name, pass, details });
}

let reg;
try {
  reg = require(path.join(ROOT, "prototypes.js"));
  check("реестр: prototypes.js загружается", true);
} catch (e) {
  check("реестр: prototypes.js загружается", false, e.message);
}

if (reg) {
  check("реестр: schema = 1", reg.schema === 1, `schema=${reg.schema}`);
  check("реестр: prototypes — непустой массив",
    Array.isArray(reg.prototypes) && reg.prototypes.length > 0,
    `записей: ${Array.isArray(reg.prototypes) ? reg.prototypes.length : "нет"}`);

  const list = Array.isArray(reg.prototypes) ? reg.prototypes : [];
  const seen = new Set();

  list.forEach((p, idx) => {
    const where = `#${idx}${p && p.id ? " (" + p.id + ")" : ""}`;

    check(`${where}: id задан и уникален`,
      typeof p.id === "string" && p.id.length > 0 && !seen.has(p.id),
      typeof p.id === "string" ? `id=${p.id}` : "id отсутствует");
    if (typeof p.id === "string") seen.add(p.id);

    check(`${where}: title задан`,
      typeof p.title === "string" && p.title.trim().length > 0);

    check(`${where}: status допустим`,
      STATUSES.includes(p.status),
      `status=${p.status} (допустимо: ${STATUSES.join(", ")})`);

    check(`${where}: tags — массив строк`,
      Array.isArray(p.tags) && p.tags.every((t) => typeof t === "string"),
      Array.isArray(p.tags) ? `${p.tags.length} тег(ов)` : "tags не массив");

    const hasPath = typeof p.path === "string" && p.path.length > 0;
    check(`${where}: path задан`, hasPath, hasPath ? p.path : "path отсутствует");
    if (hasPath) {
      const abs = path.join(ROOT, p.path);
      check(`${where}: файл path существует`, fs.existsSync(abs), abs);
    }

    if (Array.isArray(p.links)) {
      p.links.forEach((l, li) => {
        const ok = l && typeof l.path === "string" && fs.existsSync(path.join(ROOT, l.path));
        check(`${where}: link #${li} существует`, ok, l ? l.path : "нет ссылки");
      });
    }
  });
}

let failed = 0;
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.details ? "  — " + r.details : ""}`);
  if (!r.pass) failed++;
}
console.log(`\n${results.length - failed}/${results.length} проверок реестра пройдено`);
if (failed) process.exitCode = 1;
