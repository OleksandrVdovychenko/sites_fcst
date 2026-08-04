# Мікроадмінка новин — налаштування

Редактор заходить на `https://fcst.kai.edu.ua/admin/`, логіниться корпоративним
Google-акаунтом `@kai.edu.ua` через Cloudflare Access, бачить список новин і
форми «Нова новина» / «Редагувати». Жодного Git, GitHub-акаунта чи коду з
боку редактора.

Це заміна раніше запланованого Sveltia CMS (`public/admin/`) — власна легка
адмінка без окремого OAuth Worker, бо авторизацію повністю бере на себе
Cloudflare Access.

## Файли
- `src/pages/admin/index.astro` — список новин (тягне дані з `/api/news`).
- `src/pages/admin/new.astro`, `src/pages/admin/edit.astro` — форми створення/редагування.
- `functions/api/news/index.ts` — `GET` список, `POST` створення.
- `functions/api/news/[slug].ts` — `GET`/`PUT`/`DELETE` однієї новини.
- `functions/api/_middleware.ts` — захист `/api/*` на рівні коду (додатково до Access).
- `functions/api/_lib/` — GitHub Contents API, фронтматтер, слаги.

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
- `BASE_BRANCH` — `main`.

Після додавання змінних — новий деплой (Retry deployment), щоб Functions їх підхопили.

### 3. Cloudflare Access — хто може заходити на /admin/
Потрібен план Cloudflare із **Zero Trust / Access** (є в безкоштовному тарифі
до 50 користувачів).
1. **Zero Trust dashboard** → **Access → Applications** → **Add an application** → **Self-hosted**.
2. Domain: `fcst.kai.edu.ua`, Path: `/admin*`.
3. Додати другий Application тим самим способом для Path `/api/*` (або один
   Application із двома шляхами — залежно від версії дашборду), інакше
   `/api/news` лишиться доступним без логіну в обхід форми.
4. **Identity providers** → підключити **Google** (якщо ще не підключено:
   Zero Trust → Settings → Authentication → Add → Google, OAuth-клієнт із
   Google Cloud Console з дозволеним доменом `kai.edu.ua`).
5. **Policies**: Allow, Include → **Emails ending in** `@kai.edu.ua`
   (або конкретний список email редакторів).
6. Зберегти. Перевірити: відкрити `/admin/` у приватному вікні — має
   зʼявитись сторінка логіну Cloudflare з кнопкою Google.

### 4. Перевірка
1. Залогінитись на `/admin/` під `@kai.edu.ua`.
2. Створити тестову новину з чернеткою (`draft: true`) — переконатись, що
   з'явився коміт у GitHub і деплой у Cloudflare Pages.
3. Видалити тестову новину через адмінку.

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
- Реальна брама — Cloudflare Access policy на `/admin/*` і `/api/*`;
  `functions/api/_middleware.ts` — лише друга лінія захисту на рівні коду.
- 2FA на GitHub-акаунті власника токена.
