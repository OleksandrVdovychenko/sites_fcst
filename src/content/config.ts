import { defineCollection, z } from "astro:content";

// Схема новини = контракт. Агент і редактори зобов'язані його дотримуватись,
// інакше білд впаде — це вбудований захист від «кривих» новин.
const news = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.date(),
    category: z.enum(["Новини", "Досягнення", "Події", "Вступ", "Наука"]).default("Новини"),
    cover: z.string().optional(),
    summary: z.string().max(240),
    draft: z.boolean().default(false),
  }),
});

export const collections = { news };
