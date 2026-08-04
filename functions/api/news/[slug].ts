import type { PagesContext } from "../../_lib/types";
import type { Env } from "../_lib/github";
import { getFile, putFile, deleteFile, utf8ToBase64 } from "../_lib/github";
import { parseNews, stringifyNews, type NewsFrontmatter } from "../_lib/frontmatter";
import { uploadImage } from "../_lib/image";
import { json, errorResponse } from "../_lib/http";

const NEWS_DIR = "src/content/news";
const CATEGORIES = ["Новини", "Досягнення", "Події", "Вступ", "Наука"];

interface UpdateBody {
  title?: string;
  date?: string;
  category?: string;
  summary?: string;
  draft?: boolean;
  body?: string;
  removeCover?: boolean;
  coverImage?: { dataUrl: string } | null;
}

export const onRequestGet = async (context: PagesContext<Env>): Promise<Response> => {
  const slug = context.params.slug as string;
  const file = await getFile(context.env, `${NEWS_DIR}/${slug}.md`);
  if (!file) return errorResponse(404, "Новину не знайдено.");
  const { data, body } = parseNews(file.content);
  return json({ slug, ...data, body });
};

export const onRequestPut = async (context: PagesContext<Env>): Promise<Response> => {
  const slug = context.params.slug as string;
  const path = `${NEWS_DIR}/${slug}.md`;
  const existing = await getFile(context.env, path);
  if (!existing) return errorResponse(404, "Новину не знайдено.");
  const current = parseNews(existing.content);

  let update: UpdateBody;
  try {
    update = await context.request.json();
  } catch {
    return errorResponse(400, "Некоректний JSON у тілі запиту.");
  }

  const title = (update.title ?? "").trim();
  const date = (update.date ?? "").trim();
  const category = (update.category ?? "").trim();
  const summary = (update.summary ?? "").trim();
  const articleBody = (update.body ?? "").trim();

  if (!title) return errorResponse(400, "Поле «Заголовок» обов'язкове.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errorResponse(400, "Поле «Дата» має бути у форматі РРРР-ММ-ДД.");
  if (!CATEGORIES.includes(category)) return errorResponse(400, `Категорія має бути однією з: ${CATEGORIES.join(", ")}.`);
  if (!summary) return errorResponse(400, "Поле «Опис» обов'язкове.");
  if (summary.length > 240) return errorResponse(400, "«Опис» не може перевищувати 240 символів.");
  if (!articleBody) return errorResponse(400, "Текст новини не може бути порожнім.");

  let cover: string | undefined = current.data.cover;
  if (update.removeCover) {
    cover = undefined;
  } else if (update.coverImage?.dataUrl) {
    const email = String(context.data.userEmail ?? "адмінка");
    const result = await uploadImage(
      context.env,
      update.coverImage.dataUrl,
      `public/news/${slug}`,
      `новини: оновити обкладинку «${title}» (${email})`
    );
    if (!result.ok) return errorResponse(result.status, result.message);
    cover = result.path;
  }

  const frontmatter: NewsFrontmatter = { title, date, category, cover, summary, draft: Boolean(update.draft) };
  const content = stringifyNews(frontmatter, articleBody);
  const email = String(context.data.userEmail ?? "адмінка");
  await putFile(context.env, path, utf8ToBase64(content), `новини: оновити «${title}» (${email})`, existing.sha);

  return json({ slug, cover });
};

export const onRequestDelete = async (context: PagesContext<Env>): Promise<Response> => {
  const slug = context.params.slug as string;
  const path = `${NEWS_DIR}/${slug}.md`;
  const existing = await getFile(context.env, path);
  if (!existing) return errorResponse(404, "Новину не знайдено.");
  const email = String(context.data.userEmail ?? "адмінка");
  await deleteFile(context.env, path, `новини: видалити «${slug}» (${email})`, existing.sha);
  return json({ ok: true });
};
