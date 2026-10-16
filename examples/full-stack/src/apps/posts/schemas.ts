import { z } from "forge";

/** What leaves the server: no author email, no deletedAt. */
export const PublicPost = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  body: z.string(),
  likes: z.number(),
  createdAt: z.date(),
  author: z.object({ name: z.string() }),
  tags: z.array(z.object({ label: z.string() })),
});

export const PostInput = z.object({
  title: z.string().trim().min(1, "Le titre est obligatoire").max(200),
  body: z.string().default(""),
  tags: z.array(z.string().trim().min(1)).default([]),
});

export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
