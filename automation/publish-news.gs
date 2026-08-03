/**
 * ФКНТ — автоматична заливка новин з Google Docs у репозиторій сайту.
 *
 * Без залежностей від claude.ai: усе на Google Apps Script (безкоштовно,
 * частина Google-акаунта) + Anthropic API (окремий платний ключ, не claude.ai)
 * + GitHub REST API (звичайний PAT). Ніяких MCP-конекторів, ніякого
 * GitHub App, ніяких хмарних routine.
 *
 * ЩО РОБИТЬ (scanAndPublish, запускається за розкладом)
 *   1) перелічує Google Docs у теці fcst_news на Диску;
 *   2) звіряє з automation/news-processed.json у репозиторії — пропускає вже опубліковані;
 *   3) для кожного нового документа: експортує в Markdown → прогонsь через Claude API
 *      (чистий .md зі схемою новини за AGENTS.md) → комітить
 *      src/content/news/<slug>.md напряму в main;
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
 *      ANTHROPIC_KEY    ключ з console.anthropic.com
 *      DRIVE_FOLDER_ID  "1nP2R8SgJ5oqNH0SqJ7WoyDUICk_LcS0f"  (тека fcst_news)
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

/** Обробити один документ: експорт → нормалізація → коміт у main → оновити трекер. */
function publishDoc_(doc, processed) {
  const rawMarkdown = exportDocAsMarkdown_(doc.id);
  if (!rawMarkdown || !rawMarkdown.trim()) {
    Logger.log('Порожній документ, пропускаю: ' + doc.name);
    return;
  }
  const entry = normalizeWithClaude_(rawMarkdown, doc.name);
  const slug = uniqueSlug_(entry.date, entry.title, processed);
  const path = 'src/content/news/' + slug + '.md';

  putFileToRepo_(path, entry.md, 'Новина: ' + entry.title);

  processed[doc.id] = slug;
  saveProcessedMap_(processed);
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

/** Нормалізація через Claude: сирий Markdown → .md зі схемою новини */
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
  if (res.getResponseCode() >= 300) throw new Error('Claude API: ' + res.getContentText());
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
