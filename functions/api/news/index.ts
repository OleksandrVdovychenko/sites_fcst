import type { PagesContext } from "../_lib/types";
import type { Env } from "../_lib/github";
import { getFile, listDir, putFile, utf8ToBase64 } from "../_lib/github";
import { parseNews, stringifyNews, type NewsFrontmatter } from "../_lib/frontmatter";
import { slugify } from "../_lib/slug";
import { json, errorResponse } from "../_lib/http";

const NEWS_DIR = "src/content/news";
const CATEGORIES = ["Новини", "Досягнення", "Події", "Вступ", "Наука"];
const MAX_COVER_BYTES = 5 * 1024 * 1024;
const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

interface ListItem extends NewsFrontmatter {
  slug: string;
}

interface CreateBody {
  title?: string;
  date?: string;
  category?: string;
  summary?: string;
  draft?: boolean;
  body?: string;
  slug?: string;
  coverImage?: { dataUrl: string; filename?: string } | null;
}

export const onRequestGet = async (context: PagesContext<Env>): Promise<Response> => {
  const entries = (await listDir(context.env, NEWS_DIR)).filter((e) => e.type === "file" && e.name.endsWith(".md"));
  const items: ListItem[] = (
    await Promise.all(
      entries.map(async (entry) => {
        const file = await getFile(context.env, entry.path);
        if (!file) return null;
        const { data } = parseNews(file.content);
        const slug = entry.name.replace(/\.md$/, "");
        return {
          slug,
          title: data.title ?? slug,
          date: data.date ?? "",
          category: data.category ?? "Новини",
          cover: data.cover,
          summary: data.summary ?? "",
          draft: data.draft ?? false,
        } as ListItem;
      })
    )
  ).filter((x): x is ListItem => x !== null);

  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return json({ items });
};

function decodeDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

export const onRequestPost = async (context: PagesContext<Env>): Promise<Response> => {
  let body: CreateBody;
  try {
    body = await context.request.json();
  } catch {
    return errorResponse(400, "Некоректний JSON у тілі запиту.");
  }

  const title = (body.title ?? "").trim();
  const date = (body.date ?? "").trim();
  const category = (body.category ?? "").trim();
  const summary = (body.summary ?? "").trim();
  const articleBody = (body.body ?? "").trim();

  if (!title) return errorResponse(400, "Поле «Заголовок» обов'язкове.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errorResponse(400, "Поле «Дата» має бути у форматі РРРР-ММ-ДД.");
  if (!CATEGORIES.includes(category)) return errorResponse(400, `Категорія має бути однією з: ${CATEGORIES.join(", ")}.`);
  if (!summary) return errorResponse(400, "Поле «Опис» обов'язкове.");
  if (summary.length > 240) return errorResponse(400, "«Опис» не може перевищувати 240 символів.");
  if (!articleBody) return errorResponse(400, "Текст новини не може бути порожнім.");

  const yearMonth = date.slice(0, 7);
  const shortSlug = slugify(body.slug || title);
  const articleSlug = `${yearMonth}-${shortSlug}`;
  const filename = `${articleSlug}.md`;
  const path = `${NEWS_DIR}/${filename}`;

  const existing = await getFile(context.env, path);
  if (existing) return errorResponse(409, `Новина з файлом ${filename} уже існує — зміни заголовок або слаг.`);

  let cover: string | undefined;
  if (body.coverImage?.dataUrl) {
    const decoded = decodeDataUrl(body.coverImage.dataUrl);
    if (!decoded) return errorResponse(400, "Некоректний формат зображення обкладинки.");
    const ext = MIME_EXT[decoded.mime];
    if (!ext) return errorResponse(400, "Обкладинка має бути jpeg, png, webp або gif.");
    const approxBytes = (decoded.base64.length * 3) / 4;
    if (approxBytes > MAX_COVER_BYTES) return errorResponse(413, "Обкладинка завелика (максимум 5 МБ).");
    const imagePath = `public/news/${articleSlug}.${ext}`;
    const email = String(context.data.userEmail ?? "адмінка");
    await putFile(context.env, imagePath, decoded.base64, `новини: обкладинка для «${title}» (${email})`);
    cover = `/news/${articleSlug}.${ext}`;
  }

  const frontmatter: NewsFrontmatter = {
    title,
    date,
    category,
    cover,
    summary,
    draft: Boolean(body.draft),
  };
  const content = stringifyNews(frontmatter, articleBody);
  const email = String(context.data.userEmail ?? "адмінка");
  await putFile(context.env, path, utf8ToBase64(content), `новини: додати «${title}» (${email})`);

  return json({ slug: articleSlug, path, cover }, 201);
};
