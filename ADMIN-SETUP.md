# Мікроадмінка новин — налаштування

Редактор заходить на `https://fcst.kai.edu.ua/admin/`, логіниться корпоративним
Google-акаунтом `@kai.edu.ua` через Cloudflare Access, бачить список новин і
форми «Нова новина» / «Редагувати». Жодного Git, GitHub-акаунта чи коду з
боку редактора.

**Доступ — лише вибрані люди, не весь домен.** І політика Access у дашборді
(крок 3), і серверна перевірка (`functions/api/_middleware.ts`) звіряють
конкретний список email, а не весь `@kai.edu.ua`. Додати/прибрати редактора =
оновити список у двох місцях (Access policy + `ALLOWED_EMAILS`).

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

## Тестовий прогін пайплайну без Access (тимчасово)

Щоб перевірити, що весь ланцюжок (форма → Function → коміт у GitHub) працює,
ще до налаштування Cloudflare Access:

1. Виконати крок 1 і 2 нижче (GitHub-токен, змінні середовища), але:
   - `BASE_BRANCH` — **тестова гілка**, не `main` (напр. `admin-pipeline-test`,
     створити її в GitHub від `main`) — щоб тестові коміти не потрапляли
     у прод-контент.
   - Додатково додати `SKIP_ACCESS_CHECK` = `true` — вимикає перевірку
     заголовка Cloudflare Access у `functions/api/_middleware.ts`, `/admin/`
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
- `BASE_BRANCH` — `main`.
- `ALLOWED_EMAILS` — через кому, точний список редакторів, напр.
  `dekan@kai.edu.ua, red1@kai.edu.ua, red2@kai.edu.ua` — має **збігатися**
  зі списком email у Access policy (крок 3.5). Це друга лінія захисту:
  навіть якщо політику в дашборді хтось випадково послабить до всього
  домену, Function усе одно відхилить чужий email.

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
5. **Policies**: Allow, Include → **Emails** (конкретний список, **не**
   «Emails ending in» домену) — уписати точні адреси редакторів, ті самі,
   що в `ALLOWED_EMAILS` вище. Домен `@kai.edu.ua` лише підказує, з якого
   Google Workspace ці акаунти, доступ дає не сам домен, а явний список.
6. Зберегти. Перевірити: відкрити `/admin/` у приватному вікні — має
   зʼявитись сторінка логіну Cloudflare з кнопкою Google, і вхід під
   акаунтом поза списком має бути відхилений.

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
- Реальна брама — Cloudflare Access policy на `/admin/*` і `/api/*` зі
  списком конкретних email (не весь домен); `functions/api/_middleware.ts` +
  `ALLOWED_EMAILS` — друга лінія захисту на рівні коду з тим самим списком.
- 2FA на GitHub-акаунті власника токена.
