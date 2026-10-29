-- pdf-freeze.lua – печатная (PDF) версия методички: интерактив заменяется «застывшими» картинками.
-- Картинки делает `node tools/freeze.mjs` по собранной HTML-версии и кладёт в images/frozen/<глава>/:
--   ojs-cell-N.png, ojs-cell-N-M.png – выход N-й OJS-ячейки главы (нумерация та же, что у id в HTML);
--   высокий выход разрезан на части: ojs-cell-N.part1.png, ojs-cell-N.part2.png, …;
--   live-K.png – результат K-й живой ячейки (::: {.live-py} / ::: {.live-js}).
-- OJS-ячейка без снимка (ползунки, служебный код) из PDF просто убирается; у живой ячейки остаётся код, под ним – результат.

local chapter, nojs, nlive = nil, 0, 0
local HTML_WIDTH = 760 -- ширина колонки текста в HTML, px: снимок такой ширины займёт всю строку PDF

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function b64decode(s)
  s = s:gsub("[^%w%+/=]", "")
  return (s:gsub(".", function(c)
    if c == "=" then return "" end
    local v, bits = B64:find(c, 1, true) - 1, ""
    for i = 6, 1, -1 do bits = bits .. (v % 2 ^ i - v % 2 ^ (i - 1) > 0 and "1" or "0") end
    return bits
  end):gsub("%d%d?%d?%d?%d?%d?%d?%d?", function(b)
    if #b ~= 8 then return "" end
    local n = 0
    for i = 1, 8 do n = n * 2 + (b:sub(i, i) == "1" and 1 or 0) end
    return string.char(n)
  end))
end

-- ширина PNG в пикселях (заголовок IHDR); снимки сделаны с масштабом 2
local function pngWidth(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local head = f:read(24)
  f:close()
  if not head or #head < 24 then return nil end
  return string.unpack(">I4", head, 17)
end

local function image(path)
  local w = pngWidth(path)
  if not w then return nil end
  local pct = math.min(100, math.floor(w / 2 / HTML_WIDTH * 100 + 0.5))
  return pandoc.Para({ pandoc.Image({}, path, "", pandoc.Attr("", {}, { width = pct .. "%" })) })
end

-- снимок name.png или его части name.part1.png, name.part2.png, … (высокие выходы freeze.mjs режет на полосы)
local function frozen(name)
  local base = "images/frozen/" .. chapter .. "/" .. name
  local one = image(base .. ".png")
  if one then return { one } end
  local parts = {}
  for k = 1, 40 do
    local part = image(base .. ".part" .. k .. ".png")
    if not part then break end
    table.insert(parts, part)
  end
  return parts
end

local function onRaw(el)
  local meta = el.text:match("quarto%-file%-metadata:%s*([%w%+/=]+)")
  if not meta then return nil end
  local file = b64decode(meta):match('"bookItemFile"%s*:%s*"([^"]+)"')
  if file then
    chapter = file:gsub("%.qmd$", ""):gsub("^.*/", "")
    nojs, nlive = 0, 0
  end
  return nil
end

local function onCode(el)
  if not el.classes:includes("{ojs}") or not chapter then return nil end
  nojs = nojs + 1
  local out = frozen("ojs-cell-" .. nojs)
  for m = 1, 9 do
    for _, b in ipairs(frozen("ojs-cell-" .. nojs .. "-" .. m)) do table.insert(out, b) end
  end
  return out
end

local function onDiv(el)
  if not (el.classes:includes("live-py") or el.classes:includes("live-js")) or not chapter then return nil end
  nlive = nlive + 1
  local blocks = pandoc.List(el.content)
  local imgs = frozen("live-" .. nlive)
  if #imgs > 0 then
    blocks:insert(pandoc.Para({ pandoc.Emph({ pandoc.Str("Результат выполнения:") }) }))
    blocks:extend(imgs)
  end
  return pandoc.Div(blocks), false
end

-- схемы mermaid приходят в натуральную величину (бывает 18 дюймов в высоту) – вписываем в страницу A4 с полями
local MAX_W, MAX_H = 6.3, 7.5 -- дюймы
local function inches(v)
  local n = v and tonumber(v:match("^([%d%.]+)in$"))
  return n
end

local function onImage(el)
  if not el.src:match("mermaid%-figure") then return nil end
  local w, h = inches(el.attributes.width), inches(el.attributes.height)
  if not (w and h) then return nil end
  local s = math.min(1, MAX_W / w, MAX_H / h)
  el.attributes.width = string.format("%.2fin", w * s)
  el.attributes.height = string.format("%.2fin", h * s)
  return el
end

return {
  {
    traverse = "topdown",
    RawBlock = onRaw,
    CodeBlock = onCode,
    Div = onDiv,
  },
  { Image = onImage },
}
