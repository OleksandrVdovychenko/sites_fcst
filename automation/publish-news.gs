/**
 * ФКНТ — автоматична заливка новин з Google Docs у репозиторій сайту.
 *
 * ЩО РОБИТЬ
 *   1) експортує активний Google Doc у Markdown (нативний експорт Docs);
 *   2) прогоняє текст через Claude API → чистий .md зі схемою новини (за AGENTS.md);
 *   3) відкриває PR у GitHub з файлом src/content/news/<slug>.md.
 *   Публікує людина, зливаючи PR. Автопублікації немає.
 *
 * НАЛАШТУВАННЯ (File → Project settings → Script properties):
 *   GITHUB_TOKEN   fine-grained PAT: лише репо fcst-web, contents:write + pull_requests:write
 *   GITHUB_REPO    напр. "fcst-kai/fcst-web"
 *   BASE_BRANCH    напр. "main"
 *   ANTHROPIC_KEY  ключ Claude API
 *
 * ДОДАТКОВО у appsscript.json потрібен Drive scope:
 *   "oauthScopes": ["https://www.googleapis.com/auth/documents",
 *                   "https://www.googleapis.com/auth/drive.readonly",
 *                   "https://www.googleapis.com/auth/script.external_request"]
 */

const P = PropertiesService.getScriptProperties();

/** Меню в документі */
function onOpen() {
  DocumentApp.getUi()
    .createMenu('ФКНТ')
    .addItem('Надіслати новину на сайт', 'publishCurrentDoc')
    .addToUi();
}

function publishCurrentDoc() {
  const ui = DocumentApp.getUi();
  try {
    const doc = DocumentApp.getActiveDocument();
    const rawMarkdown = exportDocAsMarkdown_(doc.getId());
    const entry = normalizeWithClaude_(rawMarkdown, doc.getName()); // {frontmatter+body, title, date}
    const slug = `${entry.date}-${transliterate_(entry.title)}`.slice(0, 60).replace(/-+$/,'');
    const path = `src/content/news/${slug}.md`;
    const prUrl = openPullRequest_(path, entry.md, `Новина: ${entry.title}`, doc.getUrl());
    ui.alert('Готово', 'Новину надіслано на розгляд.\nPR: ' + prUrl, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Помилка', String(e), ui.ButtonSet.OK);
  }
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
    'НЕ вигадуй фактів, імен, цифр, дат — лише те, що є в чернетці.';
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

/** Створити гілку + файл + PR через GitHub REST API */
function openPullRequest_(path, content, title, sourceUrl) {
  const repo = P.getProperty('GITHUB_REPO');
  const base = P.getProperty('BASE_BRANCH') || 'main';
  const token = P.getProperty('GITHUB_TOKEN');
  const api = 'https://api.github.com/repos/' + repo;
  const gh = (url, method, payload) => {
    const res = UrlFetchApp.fetch(url, {
      method: method || 'get',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: { Authorization: 'token ' + token, Accept: 'application/vnd.github+json' },
      payload: payload ? JSON.stringify(payload) : null,
    });
    if (res.getResponseCode() >= 300) throw new Error('GitHub ' + url + ': ' + res.getContentText());
    return JSON.parse(res.getContentText());
  };

  const baseSha = gh(api + '/git/ref/heads/' + base).object.sha;
  const branch = 'news/' + path.split('/').pop().replace(/\.md$/, '');
  // створити гілку (ігнорувати, якщо вже існує)
  try { gh(api + '/git/refs', 'post', { ref: 'refs/heads/' + branch, sha: baseSha }); } catch (e) {}
  // додати/оновити файл
  gh(api + '/contents/' + path, 'put', {
    message: title,
    branch: branch,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
  });
  // відкрити PR
  const pr = gh(api + '/pulls', 'post', {
    title: title,
    head: branch,
    base: base,
    body: 'Автоматично з Google Docs.\nДжерело: ' + sourceUrl + '\n\n**Перед злиттям перевірити:** факти, імена, дату, тон.',
  });
  return pr.html_url;
}

/** Проста транслітерація укр → латиниця для slug */
function transliterate_(s) {
  const map = { а:'a',б:'b',в:'v',г:'h',ґ:'g',д:'d',е:'e',є:'ie',ж:'zh',з:'z',и:'y',і:'i',ї:'i',й:'i',
    к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',
    ь:'',ю:'iu',я:'ia',' ':'-','’':'',"'":'' };
  return s.toLowerCase().split('').map(c => (c in map ? map[c] : /[a-z0-9]/.test(c) ? c : '-')).join('')
    .replace(/-+/g, '-').replace(/^-|-$/g, '');
}
