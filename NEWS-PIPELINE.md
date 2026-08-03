# Заливка новин: Google Docs → сайт

Автор пише новину звичайним Google Doc у спеціальній теці на Диску й нічого
більше не робить — ні Git, ні CMS, ні кнопок у документі. Автоматизація сама
знаходить нові документи, перетворює їх на новину сайту й публікує.

Працює **без claude.ai** (без MCP-конекторів, без GitHub App, без хмарних
routine) — увесь конвеєр живе на Google Apps Script + Anthropic API +
GitHub REST API.

```
Google Doc у теці fcst_news  →  Apps Script (погодинний тригер)
    →  Drive API: список докʼів у теці  →  automation/news-processed.json (нові?)
    →  експорт у Markdown  →  Claude API нормалізує в схему src/content/config.ts
    →  коміт напряму в main (GitHub REST API)  →  Cloudflare перебілд  →  новина на сайті
```

## Що робить автор
1. Пише новину у звичайний Google Doc (текст, підзаголовки).
2. Кладе документ у теку **fcst_news** на Google Диску
   (`https://drive.google.com/drive/folders/1nP2R8SgJ5oqNH0SqJ7WoyDUICk_LcS0f`).
3. Усе. Протягом години новина сама з'явиться на сайті.

## Як це працює технічно (`automation/publish-news.gs`)
1. Погодинний тригер запускає `scanAndPublish()`.
2. Скрипт перелічує Google Docs у теці `fcst_news` через Drive API.
3. Звіряє `id` кожного документа з `automation/news-processed.json` у
   репозиторії (читає файл через GitHub Contents API) — пропускає вже
   опубліковані.
4. Для кожного нового документа: експортує Doc у Markdown (нативний експорт
   Docs), прогонsь через Anthropic API (ключ з console.anthropic.com, **не**
   claude.ai) → чистий `.md` зі строгим frontmatter (`title, date, category,
   summary, draft`), **не вигадуючи фактів** — лише те, що є в документі.
   Якщо факти неоднозначні — модель сама ставить `draft: true`.
5. Комітить `src/content/news/<дата>-<слаг>.md` **напряму в main** через
   GitHub REST API (Contents API, без гілки й без PR) — свідомий виняток із
   золотого правила AGENTS.md, узгоджений з власником сайту саме для цього
   конвеєра.
6. Оновлює `automation/news-processed.json` (`docId → slug`) окремим комітом.
7. Cloudflare Pages підхоплює пуш і перебілдовує сайт автоматично.

## Разове налаштування
1. Тека `fcst_news` на Диску `oleksandr.vdovychenko@kai.edu.ua` — вже створена.
2. [script.google.com](https://script.google.com) → New project → вставити
   вміст `automation/publish-news.gs` як `Code.gs`.
3. **Project Settings → Script properties** додати:
   - `GITHUB_TOKEN` — fine-grained PAT: лише цей репозиторій, право `contents:write`
   - `GITHUB_REPO` — `OleksandrVdovychenko/sites_fcst`
   - `BASE_BRANCH` — `main`
   - `ANTHROPIC_KEY` — ключ з console.anthropic.com
   - `DRIVE_FOLDER_ID` — `1nP2R8SgJ5oqNH0SqJ7WoyDUICk_LcS0f`
4. У маніфесті (**View → Show manifest file** → `appsscript.json`) додати:
   ```json
   "oauthScopes": [
     "https://www.googleapis.com/auth/drive.readonly",
     "https://www.googleapis.com/auth/script.external_request"
   ]
   ```
5. Запустити функцію **`installTrigger`** вручну один раз у редакторі Apps
   Script — Google попросить авторизувати доступ (Drive read-only + зовнішні
   запити), а сам скрипт поставить собі погодинний тригер. Перевірити в
   розділі **Triggers** (значок годинника зліва), що `scanAndPublish` там є.
6. Для ручної перевірки — запустити `scanAndPublish` і подивитись
   **Executions** (лог виконання) та вкладку **Executions log**.

Увесь конвеєр належить власнику Google-акаунта, який запускає скрипт —
Anthropic API-ключ і GitHub PAT зберігаються лише в Script Properties цього
проєкту Apps Script, ніде більше.

## Чесні застереження
- **Картинки — найслабше місце.** У v1 автор вставляє в текст документа
  **посилання на вже розміщене фото** (або лишає без фото) — автоматичне
  вилучення вбудованих у Doc зображень не реалізоване. Якщо картинка потрібна
  в картці новини, розробник додає її вручну пізніше.
- **Без рецензії перед публікацією.** Це свідомий вибір власника сайту для
  цього конвеєра. Якщо факти/імена/дати в документі неоднозначні — модель
  ставить `draft: true` замість вигадування, і новина не з'являється в
  стрічці, доки хтось не поправить `.md` вручну.
- **Повторне редагування документа.** Якщо автор редагує вже опублікований
  Doc, зміни на сайті автоматично НЕ підхоплюються (`docId` уже в
  `news-processed.json`) — правки в опубліковану новину вносяться вручну
  в `.md`-файл.
- **Категорія.** Якщо з тексту не очевидна категорія — ставиться
  `Новини` (дефолт схеми).
- **Квоти Apps Script.** Погодинний тригер + виклики Drive/Claude/GitHub API
  вкладаються у безкоштовні денні квоти Google для звичайного акаунта з
  великим запасом (десятки, не тисячі новин на день).

## Межа відповідальності
- **Автори новин** — Google Docs, тека `fcst_news`. Ніякого Git.
- **Розробники** — Claude Code з прямим доступом до репозиторію (код,
  шаблони, макети сторінок) — і далі через PR, окрім самого новинного
  конвеєра, який пушить напряму в `main`.
