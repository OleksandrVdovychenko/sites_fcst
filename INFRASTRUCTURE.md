# Інфраструктура сайту ФКНТ — облікові записи та сервіси

Повний перелік усього, від чого зараз залежить сайт: де що зареєстровано,
під яким акаунтом і що там налаштовано. Написано для одного конкретного
майбутнього завдання — **перенести все з особистих акаунтів власника
(`alexandr.vdovichenko1986@gmail.com` / `OleksandrVdovychenko` на GitHub) на
акаунти, якими володіє університет/факультет**, без втрати роботи сайту.

Деякі значення (точний Cloudflare team domain, приватність GitHub-репо, чи
є Apps Script на тому самому GCP-проєкті, що й Cloudflare Access) я не можу
перевірити з коду — позначені 🔲 **[перевірити]**, впишіть точне значення
самі, звірившись із відповідним дашбордом.

---

## Рівень 1 — короткий огляд

| Сервіс | Хто власник зараз | Навіщо | Що на ньому тримається |
|---|---|---|---|
| **GitHub** | `OleksandrVdovychenko` (особистий акаунт) | Репозиторій `sites_fcst` — єдине джерело правди для коду й контенту | Весь код сайту, усі новини, `main` = продакшн |
| **Cloudflare Pages** | Особистий Cloudflare-акаунт власника | Хостинг + білд + Cloudflare Pages Functions (бекенд адмінки) | Домен `sites-fcst.pages.dev`, env vars із секретами |
| **Cloudflare Zero Trust / Access** | Той самий Cloudflare-акаунт | Ворота логіну на `/admin/*` і `/api/*` | Identity Provider (Google), Access-політика |
| **Google Cloud (OAuth-клієнт)** | Особистий Google-акаунт власника | Дозволяє Cloudflare Access приймати вхід через Google | OAuth consent screen + Client ID/Secret проєкту `fcst-news` |
| **Google Drive + Apps Script** | Той самий особистий Google-акаунт | Окремий конвеєр публікації новин (Google Docs → сайт) | Тека `fcst_news` на Диску, тригер, Script Properties із власним GitHub-токеном |
| **Домен `fcst.kai.edu.ua`** | Керується десь окремо (не Cloudflare Pages) | Публічна адреса факультету | 🔲 **[перевірити]** — зараз усе ще показує старий WordPress-сайт, на новий не переключено |

**Загальний принцип міграції:** нічого з цього не переноситься автоматично.
Для кожного рядка — новий акаунт, нові секрети, оновлені посилання одне на
одне (наприклад: новий GitHub-токен → вписати в нові Cloudflare Pages env
vars; новий Cloudflare-акаунт → перепідключити GitHub App, перестворити
Access Application). Детально — нижче.

---

## Рівень 2 — детально по кожному сервісу

### 1. GitHub

- **Репозиторій:** `OleksandrVdovychenko/sites_fcst` — https://github.com/OleksandrVdovychenko/sites_fcst
- **Видимість:** 🔲 **[перевірити]** (публічний чи приватний) — Settings репозиторію → General.
- **Гілка продакшну:** `main`. Прямі коміти в неї роблять лише два автоматизовані канали (Apps Script і мікроадмінка), людина — лише через Pull Request (`AGENTS.md`).
- **Токени доступу (Fine-grained PAT), обидва живуть поза репозиторієм:**
  - Один — у Cloudflare Pages env vars (`GITHUB_TOKEN`), для мікроадмінки.
  - Другий — у Google Apps Script Script Properties (`GITHUB_TOKEN`), для Docs-конвеєра.
  - 🔲 **[перевірити]** — це один і той самий токен чи два різні. Обидва мають бути fine-grained, **лише цей репозиторій**, право **Contents: Read and write**, нічого більше.

**Як мігрувати:**
1. Створити організацію/акаунт GitHub, яким володіє факультет/університет (не особиста пошта).
2. Перенести репозиторій (Settings → General → Transfer ownership) **або** створити новий репозиторій в організації і запушити туди весь код і історію.
3. Згенерувати нові fine-grained PAT під новим власником — окремо для Cloudflare Pages, окремо для Apps Script (не переюзати особисті токени).
4. Оновити `GITHUB_REPO` і `GITHUB_TOKEN` у Cloudflare Pages env vars (розділ 2 нижче) і в Apps Script Script Properties (розділ 5).
5. Перепідключити Cloudflare Pages до нового розташування репозиторію (GitHub-застосунок Cloudflare підключений до конкретного акаунта/організації — після transfer знадобиться заново авторизувати доступ Cloudflare до нового власника в GitHub App permissions).

### 2. Cloudflare Pages

- **Cloudflare-акаунт:** особистий, той самий, що й Zero Trust (розділ 3) — вони завжди в межах одного акаунта.
- **Проєкт:** `sites-fcst` → `https://sites-fcst.pages.dev`
- **Підключення:** Git-інтеграція на репозиторій із розділу 1, гілка `main`, білд-команда `npm run build`, тека виводу `dist`.
- **Кастомний домен:** `fcst.kai.edu.ua` — 🔲 **[перевірити/зробити]** — ще **не доданий** до проєкту; зараз цей домен показує старий сайт (інший хостинг). Cutover — окрема майбутня задача.
- **Environment variables (Production):**
  | Змінна | Тип | Значення (поточне) |
  |---|---|---|
  | `GITHUB_TOKEN` | Secret (encrypted) | fine-grained PAT з розділу 1 |
  | `GITHUB_REPO` | Plaintext | `OleksandrVdovychenko/sites_fcst` |
  | `BASE_BRANCH` | Plaintext | `main` |
  | `ALLOWED_EMAILS` | Plaintext | `oleksandr.vdovychenko@kai.edu.ua` — єдиний список, хто має доступ до `/admin/` |
  | `SKIP_ACCESS_CHECK` | — | не встановлена (і не повинна бути, крім тестових прогонів) |

**Як мігрувати:**
1. Створити новий Cloudflare-акаунт на університетську пошту (або отримати доступ до вже наявного акаунта університету, якщо є).
2. Створити новий Pages-проєкт, підключити до репозиторію з розділу 1 (уже під новим GitHub-власником).
3. Перенести всі env vars із таблиці вище (значення — після оновлення GitHub-токена).
4. Додати кастомний домен `fcst.kai.edu.ua` до нового проєкту (Custom domains → Set up a domain) — потребує керування DNS-записами домену.
5. Стара версія `sites-fcst.pages.dev` лишається як є або видаляється — на розсуд.

### 3. Cloudflare Zero Trust / Access

- **Акаунт:** той самий Cloudflare-акаунт, що й Pages.
- **Team domain:** 🔲 **[перевірити й вписати]** `______________.cloudflareaccess.com`
  (Zero Trust → Settings → Custom Pages).
- **Application(и):** захищають `sites-fcst.pages.dev/admin*` і `/api/*`.
  🔲 **[перевірити]** — один Application із двома шляхами чи два окремих.
- **Identity Provider:** Google (OAuth-клієнт із розділу 4).
- **Policy:** Allow → Include → **Login Methods: Google** — свідомо **без**
  списку email. Хто саме проходить далі, вирішує `ALLOWED_EMAILS` у
  Cloudflare Pages (розділ 2), а не ця політика. Див. `ADMIN-SETUP.md`.

**Як мігрувати:**
1. Zero Trust вмикається на новому Cloudflare-акаунті (розділ 2, крок 1) —
   вибрати team name під час першого входу в Zero Trust dashboard.
2. Повторити Identity Provider (новий OAuth-клієнт із розділу 4, під
   новим Google-акаунтом — старий Client ID/Secret прив'язаний до старого
   team domain і не спрацює на новому).
3. Створити Application(и) і Policy заново — так само, як у розділі вище.
4. Оновити redirect URI в Google Cloud Console на новий team domain
   (розділ 4) — інакше логін не пройде.

### 4. Google Cloud — OAuth-клієнт для Cloudflare Access

- **Google-акаунт:** `alexandr.vdovichenko1986@gmail.com` (особистий).
- **GCP-проєкт:** `fcst-news` (OAuth consent screen App name: «FCST news
  pipeline»). 🔲 **[перевірити]** — це той самий GCP-проєкт, що й у
  розділі 5 (Apps Script), чи окремий — судячи з назви, ймовірно той самий.
- **OAuth consent screen:** User type **External**, Publishing status
  **In production** (верифікація Google не знадобилась — використовуються
  лише базові non-sensitive scope: `email`/`profile`/`openid`).
- **OAuth Client (Web application):** Client ID/Secret вставлені напряму в
  Cloudflare Access Identity Provider (розділ 3), **ніде більше не
  зберігаються** — ні в репозиторії, ні деінде.
- **Authorized redirect URI:** `https://<team-domain>.cloudflareaccess.com/cdn-cgi/access/callback`.

**Як мігрувати:**
1. Створити новий GCP-проєкт під університетським Google-акаунтом
   (console.cloud.google.com).
2. Повторити OAuth consent screen (External, Publish to Production) і
   створити новий OAuth Client із redirect URI нового team domain
   (розділ 3, крок 4).
3. Вписати новий Client ID/Secret у Cloudflare Access.
4. Старий OAuth-клієнт можна видалити після переїзду.

### 5. Google Drive + Apps Script — Docs-конвеєр новин

Незалежний від усього вище канал публікації, докладно — `NEWS-PIPELINE.md`.

- **Google-акаунт:** `alexandr.vdovichenko1986@gmail.com`.
- **Apps Script проєкт:** містить `automation/publish-news.gs`
  (вихідний код також лежить у репозиторії — можна скопіювати 1:1).
  Прив'язаний до **явного** GCP-проєкту (не дефолтного Apps Script-проєкту
  — на дефолтному Drive API технічно неможливо увімкнути, це обмеження
  Google, не помилка налаштування). 🔲 **[перевірити]** — назва цього
  GCP-проєкту, і чи це той самий `fcst-news` із розділу 4.
- **Тека на Диску:** `fcst_news` (Drive folder ID зберігається в Script
  Properties, не в коді).
- **Script Properties** (Project Settings → Script properties):
  - `GITHUB_TOKEN` — fine-grained PAT, той самий репозиторій, `contents:write`.
    🔲 **[перевірити]** — окремий токен від Cloudflare Pages чи той самий.
  - `GITHUB_REPO` — `OleksandrVdovychenko/sites_fcst`
  - `BASE_BRANCH` — `main`
  - `DRIVE_FOLDER_ID` — id теки `fcst_news`
  - (опційно) `USE_AI_FALLBACK`, `ANTHROPIC_KEY` — за замовчуванням вимкнено.
- **Тригер:** погодинний (`installTrigger`), запущений під цим самим акаунтом.

**Як мігрувати:**
1. Створити/визначити університетський Google-акаунт (Workspace), яким
   керуватиме факультет.
2. У Google Drive цього акаунта створити нову теку (можна назвати так само,
   `fcst_news`), дати їй доступ авторам новин.
3. script.google.com → новий проєкт → вставити вміст
   `automation/publish-news.gs` як `Code.gs`.
4. Прив'язати до **явного** GCP-проєкту (не дефолтного) — інакше Drive API
   не увімкнеться (те саме обмеження, що й зараз).
5. Заповнити Script Properties новими значеннями (новий GitHub-токен з
   розділу 1, новий `DRIVE_FOLDER_ID`).
6. Додати `oauthScopes` у `appsscript.json` (список — у `NEWS-PIPELINE.md`),
   запустити `installTrigger` вручну один раз, авторизувати доступ.
7. Перевірити `scanAndPublish` вручну, подивитись **Executions**.
8. Старий тригер на особистому акаунті — вимкнути (Triggers → видалити),
   коли новий підтверджено робочим.

### 6. Домен `fcst.kai.edu.ua`

- Зараз показує **старий сайт** (WordPress) — новий на нього ще не
  переключений. Хто керує DNS-записами цього домену — 🔲 **[перевірити]**
  (сам університет, факультет, чи хтось інший).
- **Щоб переключити на новий сайт**, потрібен доступ до DNS-керування
  `kai.edu.ua` (або принаймні до під-домену `fcst`), і:
  1. Додати `fcst.kai.edu.ua` як Custom domain у Cloudflare Pages проєкті
     (розділ 2) — Cloudflare покаже, які DNS-записи потрібні (найпростіше,
     якщо сама зона `kai.edu.ua` вже на Cloudflare DNS: тоді Cloudflare
     налаштує CNAME сам одним кліком).
  2. Якщо зона НЕ на Cloudflare — додати вручну CNAME/A-запис за
     інструкцією, яку покаже Cloudflare Pages під час додавання домену.
  3. Оновити Cloudflare Access Application (розділ 3) — додати
     `fcst.kai.edu.ua` як другий домен у тій самій політиці (поки
     `sites-fcst.pages.dev` теж лишається доступним для адмінки, якщо не
     видалити його окремо).

---

## Чекліст для повної міграції на університетський акаунт (у порядку виконання)

1. 🔲 GitHub: нова організація/акаунт, перенесений репозиторій.
2. 🔲 Cloudflare: новий акаунт, новий Pages-проєкт, підключений до нового GitHub.
3. 🔲 Google Cloud: новий проєкт, новий OAuth-клієнт.
4. 🔲 Cloudflare Zero Trust: новий team domain, IdP, Application, Policy.
5. 🔲 Нові env vars у Cloudflare Pages (`GITHUB_TOKEN`, `GITHUB_REPO`, `BASE_BRANCH`, `ALLOWED_EMAILS`).
6. 🔲 Google Drive + Apps Script: новий акаунт/тека/тригер для Docs-конвеєра.
7. 🔲 Домен `fcst.kai.edu.ua` переключений на новий Cloudflare Pages проєкт.
8. 🔲 Стара особиста інфраструктура (старий Cloudflare-акаунт, старий Apps Script тригер, старі токени) — вимкнена/відкликана.
