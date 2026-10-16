import { ForgeError } from "@forge/core/errors";

/** "Todo", "my todo" -> "todo", "my-todo" (folder and package name). */
export function kebab(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** "todos" -> "Todos", "blog_posts" -> "BlogPosts". */
export function pascal(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");
}

/** English singular, good enough for model names: todos -> todo, categories -> category. */
export function singular(word: string): string {
  if (/ies$/i.test(word)) return word.slice(0, -3) + "y";
  if (/(ss|us|is)$/i.test(word)) return word;
  if (/(x|ch|sh|ss)es$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word)) return word.slice(0, -1);
  return word;
}

/** App folder name: it is also the `forge.<app>` namespace in pages, so an identifier. */
export function appName(input: string): string {
  const name = input.trim();
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    const suggestion = kebab(name).replace(/-/g, "_");
    throw new ForgeError(
      "FORGE_APP_NAME",
      `Invalid app name "${input}": use lowercase letters, digits and _ (e.g. "${/^[a-z]/.test(suggestion) ? suggestion : "todos"}")`,
    );
  }
  return name;
}

export interface AppNames {
  /** Folder and namespace: `todos`. */
  app: string;
  /** Model class: `Todo`. */
  model: string;
  /** Prisma Client delegate: `db.todo`. */
  delegate: string;
  /** URL segment: `/api/todos`, `/todos`. */
  path: string;
  /** Human label: `Todos`. */
  label: string;
}

export function namesOf(app: string): AppNames {
  const parts = app.split("_");
  const model = pascal([...parts.slice(0, -1), singular(parts.at(-1)!)].join("_"));
  return {
    app,
    model,
    delegate: model[0]!.toLowerCase() + model.slice(1),
    path: app.replace(/_/g, "-"),
    label: pascal(app).replace(/([a-z])([A-Z])/g, "$1 $2"),
  };
}
