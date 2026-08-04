// Мінімальний парсер/серіалізатор фронтматтера новин — навмисно не загальний
// YAML, лише під схему src/content/config.ts (щоб не тягнути залежність у Workers).

export interface NewsFrontmatter {
  title: string;
  date: string; // YYYY-MM-DD
  category: string;
  cover?: string;
  summary: string;
  draft: boolean;
}

const FIELD_ORDER: (keyof NewsFrontmatter)[] = ["title", "date", "category", "cover", "summary", "draft"];

function yamlEscape(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlUnescape(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1);
  }
  return v;
}

export function stringifyNews(data: NewsFrontmatter, body: string): string {
  const lines = ["---"];
  for (const key of FIELD_ORDER) {
    const value = data[key];
    if (value === undefined || value === "") continue;
    if (key === "draft") {
      lines.push(`draft: ${Boolean(value)}`);
    } else if (key === "date") {
      lines.push(`date: ${value}`);
    } else {
      lines.push(`${key}: ${yamlEscape(String(value))}`);
    }
  }
  lines.push("---", "", body.trim(), "");
  return lines.join("\n");
}

export function parseNews(raw: string): { data: Partial<NewsFrontmatter>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw.trim() + "\n" };
  const [, fm, rest] = match;
  const data: Record<string, unknown> = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    data[key] = key === "draft" ? rawValue.trim() === "true" : yamlUnescape(rawValue);
  }
  return { data, body: rest.replace(/^\n+/, "").trimEnd() + "\n" };
}
