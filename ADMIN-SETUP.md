# Мікроадмінка новин — налаштування

Редактор заходить на `https://fcst.kai.edu.ua/admin/`, логіниться корпоративним
Google-акаунтом `@kai.edu.ua` через Cloudflare Access, бачить список новин і
форми «Нова новина» / «Редагувати». Жодного Git, GitHub-акаунта чи коду з
боку редактора.

**Доступ — лише вибрані люди, не весь домен, і керується з одного місця.**
Cloudflare Access-політика в дашборді лише вимагає «увійти через Google» —
вона навмисно **не** містить списку email і її більше не треба чіпати.
Хто саме після цього має доступ, вирішує `ALLOWED_EMAILS` — змінна
середовища в Cloudflare Pages, звіряється кодом (`functions/_lib/access.ts`)
і для сторінок (`functions/admin/_middleware.ts`), і для API
(`functions/api/_middleware.ts`). Додати/прибрати редактора = змінити один
рядок в `ALLOWED_EMAILS` і задеплоїти — жодних правок у Zero Trust дашборді.

Це заміна раніше запланованого Sveltia CMS (`public/admin/`) — власна легка
адмінка без окремого OAuth Worker, бо авторизацію повністю бере на себе
Cloudflare Access.

## Файли
- `src/pages/admin/index.astro` — список новин (тягне дані з `/api/news`).
- `src/pages/admin/new.astro`, `src/pages/admin/edit.astro` — форми створення/редагування.
- `functions/api/news/index.ts` — `GET` список, `POST` створення.
- `functions/api/news/[slug].ts` — `GET`/`PUT`/`DELETE` однієї новини.
- `functions/api/news/upload.ts` — заливка картинки для вставки в тіло новини.
- `functions/_lib/access.ts` — єдина перевірка доступу (`ALLOWED_EMAILS` +
  заголовок від Cloudflare Access), викликається з обох middleware нижче.
- `functions/admin/_middleware.ts` — захист сторінок `/admin/*`.
- `functions/api/_middleware.ts` — захист `/api/*`.
- `functions/api/_lib/` — GitHub Contents API, фронтматтер, слаги, заливка зображень.

## Як це працює
Функції комітять `.md`-файл (і, якщо є, обкладинку в `public/news/`) **напряму
в `main`** через GitHub Contents API — так само, як `automation/publish-news.gs`.
Це свідомий виняток із золотого правила `AGENTS.md`: тут комітить не ШІ-агент,
а автентифікований через Cloudflare Access редактор, кожна дія лягає в лог
GitHub-коміту з його email у повідомленні. Після коміту Cloudflare Pages сам
перебілдовує сайт (звичайний автодеплой з `main`), новина зʼявляється за
секунди-хвилину.

**Слаг (імʼя файлу) незмінний після створення** — редагування не перейменовує
`.md`, щоб не ламати посилання `/news/<slug>/`.

## Тестовий прогін пайплайну без Access (тимчасово)

Щоб перевірити, що весь ланцюжок (форма → Function → коміт у GitHub) працює,
ще до налаштування Cloudflare Access:

1. Виконати крок 1 і 2 нижче (GitHub-токен, змінні середовища), але:
   - `BASE_BRANCH` — **тестова гілка**, не `main` (напр. `admin-pipeline-test`,
     створити її в GitHub від `main`) — щоб тестові коміти не потрапляли
     у прод-контент.
   - Додатково додати `SKIP_ACCESS_CHECK` = `true` — вимикає перевірку
     заголовка Cloudflare Access у `functions/_lib/access.ts`, `/admin/`
     і `/api/news` стають відкритими без логіну.
2. **Не** налаштовувати Cloudflare Access на цьому кроці — саме це і
   пропускаємо для першого прогону.
3. Відкрити `/admin/`, створити тестову новину (можна з `draft: true`),
   переконатись, що в репозиторії на гілці `admin-pipeline-test` з'явився
   реальний коміт з `.md`-файлом (і, якщо додавали, картинкою в `public/news/`).
   Перевірити редагування і видалення так само.
4. **Одразу після тесту** — прибрати `SKIP_ACCESS_CHECK` (видалити змінну
   або поставити будь-яке інше значення) і перевести `BASE_BRANCH` на `main`
   лише **після** того, як пройдено розділ нижче про Cloudflare Access.
   Поки `SKIP_ACCESS_CHECK=true` лишається в Production env vars — адмінка
   відкрита будь-кому в інтернеті, хто вгадає `/admin/`.
5. Видалити тестову гілку `admin-pipeline-test` і зайві тестові коміти в ній,
   коли перевірка завершена.

## Разове налаштування (робить власник сайту в дашбордах Cloudflare/GitHub)

### 1. GitHub — токен для Function
1. GitHub → **Settings → Developer settings → Fine-grained tokens** → New token.
2. **Only select repositories** → цей репозиторій.
3. **Repository permissions → Contents** → Read and write.
4. Скопіювати токен (одноразово показується).

### 2. Cloudflare Pages — змінні середовища
Проєкт Pages → **Settings → Environment variables** (Production, і за бажанням Preview):
- `GITHUB_TOKEN` — токен із кроку 1, **зашифрувати** (Encrypt).
- `GITHUB_REPO` — `власник/репозиторій` (напр. `OleksandrVdovychenko/sites_fcst`).
- `BASE_BRANCH` — `main` (після тестового прогону перевести назад із тестової гілки).
- `ALLOWED_EMAILS` — через кому, точний список редакторів, **єдине місце**,
  де він живе. **Поточний стан:** лише `oleksandr.vdovychenko@kai.edu.ua` —
  особистий gmail-акаунт власника (`alexandr.vdovichenko1986@gmail.com`)
  **навмисно не в списку**, доступу до адмінки не має. Cloudflare Access
  policy (крок 3) при цьому лишається generic і не містить email — не
  синхронізуй її з цим списком, вона просто вимагає вхід через Google.
- Прибрати `SKIP_ACCESS_CHECK`, якщо лишався від тестового прогону.

Після додавання змінних — новий деплой (Retry deployment), щоб Functions їх підхопили.

### 3. Cloudflare Access — вимога увійти через Google (generic, без списку email)
Потрібен план Cloudflare із **Zero Trust / Access** (є в безкоштовному тарифі
до 50 користувачів). Ця політика навмисно **не** вирішує, хто саме має
доступ — лише змушує пройти Google-логін. Список редакторів — виключно в
`ALLOWED_EMAILS` (крок 2), і саме його треба міняти, коли додаєш/прибираєш
людину, а не цю політику.
1. **Zero Trust dashboard** → **Access → Applications** → **Add an application** → **Self-hosted**.
2. Domain: **поточно `sites-fcst.pages.dev`** (кастомний домен `fcst.kai.edu.ua`
   ще не переключений на новий сайт, там і досі старий WordPress — коли
   переключите, додайте його в цю ж політику як другий домен). Path: `/admin*`.
3. Додати другий Application тим самим способом для Path `/api/*` (або один
   Application із двома шляхами — залежно від версії дашборду), інакше
   `/api/news` лишиться доступним без логіну в обхід форми.
4. **Identity providers** → підключити **Google** (якщо ще не підключено:
   Zero Trust → Settings → Authentication → Add → Google, OAuth-клієнт із
   Google Cloud Console, App published в Production — верифікація для
   базових scope не потрібна).
5. **Policies**: Allow, Include → **Login Methods** → **Google** — без
   правила на `Emails`. Будь-хто, хто зможе увійти через Google, пройде цю
   політику; фактичний фільтр — `ALLOWED_EMAILS` у Function.
6. Зберегти. Перевірити: відкрити `/admin/` у приватному вікні — має
   зʼявитись сторінка логіну Cloudflare з кнопкою Google.

### 4. Перевірка
1. Залогінитись на `/admin/` під `oleksandr.vdovychenko@kai.edu.ua` — має пустити.
2. Спробувати залогінитись під особистим gmail-акаунтом — Access пропустить
   логін (політика generic), але `functions/admin/_middleware.ts` має
   відповісти 401 і не показати саму сторінку — це і є фактичний фільтр.
3. Створити тестову новину з чернеткою (`draft: true`) на `main` — переконатись,
   що з'явився коміт у GitHub і деплой у Cloudflare Pages.
4. Видалити тестову новину через адмінку.
5. Видалити тестову гілку (`admin-pipeline-test` чи як вона названа), якщо
   лишилась від прогону в попередньому розділі.

## Чесні застереження
- **Без рецензії перед публікацією** (як і в Docs-конвеєрі) — свідомий вибір
  власника сайту. Захист від помилок — чернетка (`draft: true`) перед тим, як
  показати редактору, як усе виглядає, і те, що кожен коміт підписаний
  email автора.
- **Обкладинки старих версій не видаляються автоматично** — заміна картинки
  чи видалення новини лишає файл у `public/news/` (не критично для розміру
  репозиторію, прибирається вручну за потреби).
- **Один запит — один коміт на файл.** Створення з обкладинкою = 2 коміти
  (картинка, потім `.md`), Cloudflare Pages може зібрати сайт двічі поспіль —
  нешкідливо, лише зайва хвилина білду.
- **Ліміт GitHub API** — fine-grained PAT має 5000 запитів/год, список новин
  робить N+1 запитів (по одному на файл) — з нинішньою кількістю новин
  (десятки) це на порядки нижче ліміту.

## Безпека — коротко
- `GITHUB_TOKEN` — лише в Cloudflare Pages env vars (encrypted), ніколи в репо.
- Токен — fine-grained, лише цей репозиторій, лише `contents:write`.
- Cloudflare Access — вимагає автентифікацію (хтось увійшов через Google) на
  `/admin/*` і `/api/*`, без списку email. **Авторизація** (хто саме) —
  повністю в `ALLOWED_EMAILS`, звіряється кодом на обох шляхах
  (`functions/_lib/access.ts`). Один список, одне місце для змін.
- 2FA на GitHub-акаунті власника токена.
