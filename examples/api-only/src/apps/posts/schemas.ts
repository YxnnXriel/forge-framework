import { z } from "forge";

/** What a client is allowed to see: `authorEmail` is not listed, so it is stripped. */
export const PublicPost = z.object({
  id: z.number(),
  title: z.string(),
  body: z.string(),
  published: z.boolean(),
});

export const PostInput = z.object({
  title: z.string().min(1).max(200),
  body: z.string().default(""),
  published: z.boolean().default(false),
});

/** Partial update: no defaults, so absent fields are left untouched. */
export const PostPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().optional(),
  published: z.boolean().optional(),
});
