/**
 * Django-style automatic migration names, computed from the difference
 * between the models of the last migration and the current ones:
 *   initial, create_post, post_likes, remove_post_likes, alter_post_title,
 *   delete_tag, create_post_and_more...
 */

type Shape = Map<string, Map<string, string>>;

/** Models and their field lines, from a Forge-generated schema. */
export function parseGenerated(content: string): Shape {
  const shape: Shape = new Map();
  for (const m of content.matchAll(/^(model|enum) (\w+) \{\n([\s\S]*?)\n\}/gm)) {
    const fields = new Map<string, string>();
    for (const line of m[3]!.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("@@") || t.startsWith("//")) {
        if (t.startsWith("@@")) fields.set(t, t);
        continue;
      }
      const [name, ...rest] = t.split(/\s+/);
      fields.set(m[1] === "enum" ? `value_${name}` : name!, rest.join(" "));
    }
    shape.set(`${m[1] === "enum" ? "enum_" : ""}${m[2]}`, fields);
  }
  return shape;
}

const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();

export function migrationName(previous: string | null, next: string, isFirst: boolean): string {
  if (isFirst || previous === null) return "initial";
  const before = parseGenerated(previous);
  const after = parseGenerated(next);
  const parts: string[] = [];

  for (const [model, fields] of after) {
    const old = before.get(model);
    if (!old) {
      parts.push(`create_${snake(model)}`);
      continue;
    }
    for (const [field, def] of fields) {
      if (field.startsWith("@@")) continue;
      if (!old.has(field)) parts.push(`${snake(model)}_${snake(field)}`);
      else if (old.get(field) !== def) parts.push(`alter_${snake(model)}_${snake(field)}`);
    }
    for (const field of old.keys()) {
      if (!field.startsWith("@@") && !fields.has(field)) parts.push(`remove_${snake(model)}_${snake(field)}`);
    }
    const idx = (f: Map<string, string>) => [...f.keys()].filter((k) => k.startsWith("@@")).sort().join("|");
    if (idx(old) !== idx(fields)) parts.push(`${snake(model)}_indexes`);
  }
  for (const model of before.keys()) if (!after.has(model)) parts.push(`delete_${snake(model)}`);

  if (parts.length === 0) return "auto";
  const name = parts.length === 1 ? parts[0]! : `${parts[0]}_and_more`;
  return name.slice(0, 60).replace(/_+$/, "");
}
