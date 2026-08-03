/**
 * ФКНТ — автоматична заливка новин з Google Docs у репозиторій сайту.
 *
 * Без залежностей від claude.ai і, за замовчуванням, БЕЗ платного API:
 * автор заповнює просту текстову шапку на початку документа
 * (Заголовок / Дата / Категорія / Опис), а скрипт читає її сам —
 * жодної нормалізації через модель. Google Apps Script (безкоштовно) +
 * GitHub REST API (звичайний PAT). Anthropic API — опційний, вимкнений
 * за замовчуванням (див. USE_AI_FALLBACK нижче).
 *
 * ФОРМАТ ШАПКИ (перші рядки документа, звичайним текстом, без стилів):
 *   Заголовок: Команда ФКНТ перемогла на хакатоні
 *   Дата: 2026-08-03
 *   Категорія: Досягнення
 *   Опис: Короткий опис у 1–2 речення.
 *   Зображення: https://.../фото-для-обкладинки.jpg   (необов'язково)
 *
 *   Далі, після шапки — порожній рядок, і власне текст новини. Якщо десь
 *   у тексті новини потрібна картинка — вставте посилання на вже
 *   розміщене фото ОКРЕМИМ рядком у тому місці, де вона має з'явитись;
 *   скрипт сам перетворить такий рядок на зображення в тілі новини.
 *
 * Кожне поле шапки (і «Зображення») необов'язкове. Якщо чогось бракує або
 * воно не розпізнане — скрипт підставляє безпечне значення за замовчуванням
 * (назву документа як заголовок, сьогоднішню дату, категорію «Новини»,
 * перші речення тексту як опис) і **ставить draft: true**, щоб новина
 * НЕ з'явилась на сайті, доки хтось не перевірить і не поправить .md
 * вручну. Жодних вигаданих фактів — лише те, що реально є в документі.
 *
 * ЩО РОБИТЬ (scanAndPublish, запускається за розкладом)
 *   1) перелічує Google Docs у теці fcst_news на Диску;
 *   2) звіряє з automation/news-processed.json у репозиторії — пропускає вже опубліковані;
 *   3) для кожного нового документа: експортує в Markdown → розбирає шапку →
 *      комітить src/content/news/<slug>.md напряму в main;
 *   4) оновлює automation/news-processed.json (docId -> slug) окремим комітом.
 *   Публікує напряму в main без PR — свідомий виняток, узгоджений з власником сайту
 *   саме для цього конвеєра (див. NEWS-PIPELINE.md).
 *
 * РАЗОВЕ НАЛАШТУВАННЯ
 *   1. script.google.com → New project. Вставити цей файл як Code.gs.
 *   2. Project Settings → Script properties, додати:
 *      GITHUB_TOKEN     fine-grained PAT: лише цей репозиторій, права contents:write
 *      GITHUB_REPO      напр. "OleksandrVdovychenko/sites_fcst"
 *      BASE_BRANCH      "main"
 *      DRIVE_FOLDER_ID  "1nP2R8SgJ5oqNH0SqJ7WoyDUICk_LcS0f"  (тека fcst_news)
 *      -- опційно, лише якщо захочете увімкнути AI-нормалізацію пізніше --
 *      USE_AI_FALLBACK  "true"   (за замовчуванням вимкнено — просто не додавайте цей рядок)
 *      ANTHROPIC_KEY    ключ з console.anthropic.com (потрібен лише якщо USE_AI_FALLBACK=true)
 *   3. У appsscript.json (View → Show manifest file) додати oauthScopes:
 *      ["https://www.googleapis.com/auth/drive.readonly",
 *       "https://www.googleapis.com/auth/script.external_request"]
 *   4. Запустити функцію installTrigger() ОДИН РАЗ вручну (авторизує доступ
 *      і ставить погодинний тригер). Перевірити в Triggers (годинник зліва),
 *      що scanAndPublish там з'явився.
 *   5. Для ручного тесту — запустити scanAndPublish() і подивитись Executions.
 *
 * ЧЕСНІ ЗАСТЕРЕЖЕННЯ — див. NEWS-PIPELINE.md.
 */

const P = PropertiesService.getScriptProperties();
const VALID_CATEGORIES = ['Новини', 'Досягнення', 'Події', 'Вступ', 'Наука'];

/** Встановити погодинний тригер. Викликати вручну один раз. */
function installTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('scanAndPublish').timeBased().everyHours(1).create();
  Logger.log('Тригер встановлено: scanAndPublish кожну годину.');
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'scanAndPublish') ScriptApp.deleteTrigger(t);
  });
}

/** Головна функція — перевіряє теку й публікує нові документи. */
function scanAndPublish() {
  const folderId = P.getProperty('DRIVE_FOLDER_ID');
  const docs = listDocsInFolder_(folderId);
  const processed = getProcessedMap_();

  let publishedCount = 0;
  docs.forEach(doc => {
    if (processed[doc.id]) return; // вже опубліковано
    try {
      publishDoc_(doc, processed);
      publishedCount++;
    } catch (e) {
      Logger.log('Помилка при публікації "' + doc.name + '" (' + doc.id + '): ' + e);
    }
  });
  Logger.log('Перевірено документів: ' + docs.length + '. Опубліковано нових: ' + publishedCount + '.');
}

/** Список Google Docs у теці (без підпапок). */
function listDocsInFolder_(folderId) {
  const q = encodeURIComponent(
    "'" + folderId + "' in parents and mimeType='application/vnd.google-apps.document' and trashed=false"
  );
  const url = 'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)';
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('Drive files.list: ' + res.getContentText());
  return JSON.parse(res.getContentText()).files || [];
}

/** Обробити один документ: експорт → розбір шапки → коміт у main → оновити трекер. */
function publishDoc_(doc, processed) {
  const rawMarkdown = exportDocAsMarkdown_(doc.id);
  if (!rawMarkdown || !rawMarkdown.trim()) {
    Logger.log('Порожній документ, пропускаю: ' + doc.name);
    return;
  }

  const entry = (P.getProperty('USE_AI_FALLBACK') === 'true' && !hasAnyHeaderField_(rawMarkdown))
    ? normalizeWithClaude_(rawMarkdown, doc.name)
    : normalizeFromHeader_(rawMarkdown, doc.name);

  const slug = uniqueSlug_(entry.date, entry.title, processed);
  const path = 'src/content/news/' + slug + '.md';

  putFileToRepo_(path, entry.md, 'Новина: ' + entry.title);

  processed[doc.id] = slug;
  saveProcessedMap_(processed);
}

/** Чи є в тексті хоч одне розпізнане поле шапки (Заголовок/Дата/Категорія/Опис). */
function hasAnyHeaderField_(rawMarkdown) {
  return /^(Заголовок|Дата|Категорія|Опис)\s*:/im.test(rawMarkdown);
}

/**
 * Детерміністичний, без AI, розбір шапки документа.
 * Шапка — перші рядки виду "Мітка: значення". Усе після шапки — тіло новини.
 * Будь-яке відсутнє/невалідне поле → безпечне значення за замовчуванням
 * + draft: true (новина не публікується в стрічці, доки її не перевірять).
 */
function normalizeFromHeader_(rawMarkdown, docName) {
  const lines = rawMarkdown.replace(/\r\n/g, '\n').split('\n');
  const keyMap = { 'заголовок': 'title', 'дата': 'date', 'категорія': 'category', 'опис': 'summary', 'зображення': 'cover' };
  const fields = {};
  let bodyStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) { if (Object.keys(fields).length) { bodyStart = i + 1; break; } else { continue; } }
    const m = line.match(/^\**\s*(Заголовок|Дата|Категорія|Опис|Зображення)\s*\**\s*:\s*(.+)$/i);
    if (m) {
      fields[keyMap[m[1].toLowerCase()]] = m[2].trim().replace(/\*+$/, '').trim();
      bodyStart = i + 1;
    } else {
      break;
    }
  }

  let body = linkifyImageUrls_(lines.slice(bodyStart).join('\n').trim());
  let needsReview = false;

  let cover = fields.cover;
  if (cover && !/^https?:\/\/\S+$/i.test(cover)) { cover = undefined; needsReview = true; } // вказано, але не URL

  const today = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy-MM-dd');

  let title = fields.title;
  if (!title) { title = docName; needsReview = true; }

  let date = fields.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { date = today; needsReview = true; }

  let category = 'Новини';
  if (fields.category) {
    const found = VALID_CATEGORIES.find(c => c.toLowerCase() === fields.category.toLowerCase());
    if (found) category = found; else needsReview = true; // вказана, але не з переліку
  }

  let summary = fields.summary;
  if (!summary) {
    summary = excerpt_(body, 220);
    needsReview = true;
  } else if (summary.length > 240) {
    summary = summary.slice(0, 237).trim() + '...';
    needsReview = true;
  }

  if (!body) needsReview = true; // порожнє тіло — точно варто перевірити вручну

  const md = buildFrontmatter_(title, date, category, summary, cover, needsReview) + '\n' + body + '\n';
  return { md: md, title: title, date: date };
}

/** Перші ~n символів тексту до межі слова, як чесна витяжка (не вигадка). */
function excerpt_(text, n) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= n) return flat;
  const cut = flat.slice(0, n);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + '...';
}

/**
 * Рядок, що містить ЛИШЕ посилання на зображення (.jpg/.jpeg/.png/.webp/.gif,
 * можливо з ?query), перетворюємо на markdown-картинку, щоб вона реально
 * відобразилась у тілі новини. Автор просто вставляє готове посилання на
 * фото окремим рядком там, де хоче бачити картинку — жодного markdown
 * синтаксису знати не треба.
 */
function linkifyImageUrls_(body) {
  return body.split('\n').map(line => {
    const t = line.trim();
    if (/^https?:\/\/\S+\.(jpe?g|png|webp|gif)(\?\S*)?$/i.test(t)) return '![](' + t + ')';
    return line;
  }).join('\n');
}

function buildFrontmatter_(title, date, category, summary, cover, draft) {
  const lines = [
    '---',
    'title: ' + yamlString_(title),
    'date: ' + date,
    'category: ' + category,
  ];
  if (cover) lines.push('cover: ' + yamlString_(cover));
  lines.push('summary: ' + yamlString_(summary));
  lines.push('draft: ' + (draft ? 'true' : 'false'));
  lines.push('---', '');
  return lines.join('\n');
}

function yamlString_(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"';
}

/** Слаг з датою + короткою транслітерацією заголовка, унікальний серед уже опублікованих. */
function uniqueSlug_(date, title, processed) {
  const base = (date.slice(0, 7) + '-' + transliterate_(title)).slice(0, 60).replace(/-+$/, '');
  const used = new Set(Object.values(processed));
  let slug = base;
  let i = 2;
  while (used.has(slug)) {
    slug = base + '-' + i;
    i++;
  }
  return slug;
}

/** Нативний експорт Google Doc → Markdown через Drive API */
function exportDocAsMarkdown_(docId) {
  const url = 'https://www.googleapis.com/drive/v3/files/' + docId + '/export?mimeType=text%2Fmarkdown';
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('Drive export: ' + res.getContentText());
  return res.getContentText();
}

/**
 * ОПЦІЙНИЙ шлях через Anthropic API — використовується лише якщо
 * USE_AI_FALLBACK=true і в документі взагалі не знайдено жодного поля
 * шапки (тобто автор не скористався форматом вище).
 */
function normalizeWithClaude_(rawMarkdown, docName) {
  const today = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy-MM-dd');
  const system =
    'Ти редактор сайту факультету ФКНТ. Перетвори чернетку новини на файл Markdown зі строгим frontmatter. ' +
    'Формат відповіді — ЛИШЕ вміст .md, без пояснень і без ```.\n' +
    'Frontmatter (YAML) з полями саме такими:\n' +
    'title: рядок до 90 символів\n' +
    'date: YYYY-MM-DD (якщо в тексті немає дати — став ' + today + ')\n' +
    'category: одне з [Новини, Досягнення, Події, Вступ, Наука]\n' +
    'summary: 1–2 речення, до 240 символів\n' +
    'draft: false\n' +
    'Далі — тіло новини у Markdown, заголовки від ##. ' +
    'Мова українська, діловий доброзичливий тон, активний стан. ' +
    'НЕ вигадуй фактів, імен, цифр, дат — лише те, що є в чернетці. ' +
    'Якщо факти неоднозначні або чогось бракує — постав draft: true замість вигадування.';
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-api-key': P.getProperty('ANTHROPIC_KEY'), 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: system,
      messages: [{ role: 'user', content: 'Назва документа: ' + docName + '\n\nЧернетка:\n' + rawMarkdown }],
    }),
  });
  if (res.getResponseCode() >= 300) {
    Logger.log('Claude API недоступний (' + res.getResponseCode() + '), переходжу на розбір шапки без AI.');
    return normalizeFromHeader_(rawMarkdown, docName);
  }
  const md = JSON.parse(res.getContentText()).content[0].text.trim();
  return { md: md, title: frontmatterValue_(md, 'title') || docName, date: frontmatterValue_(md, 'date') || today };
}

function frontmatterValue_(md, key) {
  const m = md.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

/** GitHub REST helper */
function gh_(url, method, payload) {
  const token = P.getProperty('GITHUB_TOKEN');
  const res = UrlFetchApp.fetch(url, {
    method: method || 'get',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
    payload: payload ? JSON.stringify(payload) : null,
  });
  if (res.getResponseCode() >= 300 && res.getResponseCode() !== 404) {
    throw new Error('GitHub ' + url + ': ' + res.getContentText());
  }
  return { code: res.getResponseCode(), body: res.getContentText() ? JSON.parse(res.getContentText()) : null };
}

function repoApi_() {
  return 'https://api.github.com/repos/' + P.getProperty('GITHUB_REPO');
}

/** Прочитати automation/news-processed.json з репозиторію (гілка main). */
function getProcessedMap_() {
  const branch = P.getProperty('BASE_BRANCH') || 'main';
  const r = gh_(repoApi_() + '/contents/automation/news-processed.json?ref=' + branch);
  if (r.code === 404) return {};
  const content = Utilities.newBlob(Utilities.base64Decode(r.body.content)).getDataAsString();
  return (JSON.parse(content).processed) || {};
}

/** Записати оновлений automation/news-processed.json напряму в main. */
function saveProcessedMap_(processed) {
  const path = 'automation/news-processed.json';
  const branch = P.getProperty('BASE_BRANCH') || 'main';
  const existing = gh_(repoApi_() + '/contents/' + path + '?ref=' + branch);
  const body = JSON.stringify({
    _comment: 'docId (Google Drive) -> опублікований slug. Оновлюється automation/publish-news.gs.',
    processed: processed,
  }, null, 2);
  putFileToRepo_(path, body, 'Оновити news-processed.json', existing.code !== 404 ? existing.body.sha : undefined);
}

/** Створити/оновити файл напряму в main через Contents API. */
function putFileToRepo_(path, content, message, knownSha) {
  const branch = P.getProperty('BASE_BRANCH') || 'main';
  let sha = knownSha;
  if (sha === undefined) {
    const existing = gh_(repoApi_() + '/contents/' + path + '?ref=' + branch);
    sha = existing.code !== 404 ? existing.body.sha : undefined;
  }
  const payload = {
    message: message,
    branch: branch,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
  };
  if (sha) payload.sha = sha;
  gh_(repoApi_() + '/contents/' + path, 'put', payload);
}

/** Проста транслітерація укр → латиниця для slug */
function transliterate_(s) {
  const map = { а:'a',б:'b',в:'v',г:'h',ґ:'g',д:'d',е:'e',є:'ie',ж:'zh',з:'z',и:'y',і:'i',ї:'i',й:'i',
    к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',
    ь:'',ю:'iu',я:'ia',' ':'-','’':'',"'":'' };
  return s.toLowerCase().split('').map(c => (c in map ? map[c] : /[a-z0-9]/.test(c) ? c : '-')).join('')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
}
