// Тонка обгортка над GitHub Contents API — усі записи мікроадмінки йдуть
// напряму в BASE_BRANCH одним комітом на файл (без гілок/PR, свідомий виняток
// із золотого правила AGENTS.md, як і automation/publish-news.gs).

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string; // "власник/репозиторій"
  BASE_BRANCH: string; // напр. "main"
}

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface DirEntry {
  name: string;
  path: string;
  sha: string;
  type: string;
}

const API = "https://api.github.com";

function authHeaders(env: Env): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "fcst-admin",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function encodeGitPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function request(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API}/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: { ...authHeaders(env), ...(init.headers as Record<string, string> | undefined) },
  });
  if (!res.ok && res.status !== 404) {
    throw new GitHubError(res.status, await res.text());
  }
  return res;
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function getFile(
  env: Env,
  path: string
): Promise<{ content: string; sha: string } | null> {
  const res = await request(env, `/contents/${encodeGitPath(path)}?ref=${env.BASE_BRANCH}`);
  if (res.status === 404) return null;
  const json = (await res.json()) as { content: string; sha: string };
  return { content: base64ToUtf8(json.content), sha: json.sha };
}

export async function listDir(env: Env, path: string): Promise<DirEntry[]> {
  const res = await request(env, `/contents/${encodeGitPath(path)}?ref=${env.BASE_BRANCH}`);
  if (res.status === 404) return [];
  const json = await res.json();
  return Array.isArray(json) ? (json as DirEntry[]) : [];
}

// contentBase64 — уже base64 (текст новини кодує викликач через utf8ToBase64,
// картинку клієнт надсилає як data URL, з якого просто прибирають префікс).
export async function putFile(
  env: Env,
  path: string,
  contentBase64: string,
  message: string,
  sha?: string
): Promise<void> {
  await request(env, `/contents/${encodeGitPath(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch: env.BASE_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
}

export async function deleteFile(env: Env, path: string, message: string, sha: string): Promise<void> {
  await request(env, `/contents/${encodeGitPath(path)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch: env.BASE_BRANCH }),
  });
}
