import { z } from "forge";

/** What leaves the server: `authorEmail` is not listed, so it is stripped. */
export const PublicPost = z.object({
  id: z.number(),
  title: z.string(),
  body: z.string(),
  published: z.boolean(),
  likes: z.number(),
  createdAt: z.date(),
});

export const PostInput = z.object({
  title: z.string().trim().min(1, "Le titre est obligatoire").max(200),
  body: z.string().default(""),
  published: z.boolean().default(true),
});
