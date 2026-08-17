import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Схема новини = контракт. Агент і редактори зобов'язані його дотримуватись,
// інакше білд впаде — це вбудований захист від «кривих» новин.
const news = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/news" }),
  schema: z.object({
    title: z.string(),
    date: z.date(),
    category: z.enum(["Новини", "Досягнення", "Події", "Вступ", "Наука"]).default("Новини"),
    cover: z.string().optional(),
    summary: z.string().max(240),
    draft: z.boolean().default(false),
  }),
});

// Наразі жоден шаблон її не читає (getCollection("pages") ніде не викликається) —
// зареєстровано, щоб не впав білд і файл не загубився при переносі на Content Layer API.
const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
  }),
});

// Одна сторінка лабораторії = один файл тут. Рендерить їх усі
// src/pages/faculty/labs/[...slug].astro — жодних окремих .astro на лабораторію.
const labs = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/labs" }),
  schema: z.object({
    metaTitle: z.string(),
    description: z.string(),
    crumbLabel: z.string(),
    department: z.string(),
    title: z.string(),
    lead: z.string(),
    hero: z.object({ src: z.string(), alt: z.string(), caption: z.string() }).optional(),
    studentsText: z.string(),
    equipmentHeading: z.string(),
    equipment: z.array(z.string()).default([]),
    gallery: z.array(z.object({ src: z.string(), caption: z.string() })).default([]),
    ctaText: z.string(),
    ctaLabel: z.string(),
    ctaHref: z.string(),
  }),
});

export const collections = { news, pages, labs };
