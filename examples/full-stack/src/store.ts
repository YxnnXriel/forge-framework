/** In-memory stand-in for a database until the Prisma phase. */
export interface Post {
  id: number;
  title: string;
  body: string;
  published: boolean;
  /** Internal field: must never leave the server. */
  authorEmail: string;
  likes: number;
  createdAt: Date;
}

export class PostStore {
  #rows = new Map<number, Post>();
  #nextId = 1;

  constructor(seed: Array<Parameters<PostStore["create"]>[0]> = []) {
    for (const row of seed) this.create(row);
  }

  findMany(where: { published?: boolean } = {}): Post[] {
    return [...this.#rows.values()].filter((p) => where.published === undefined || p.published === where.published);
  }

  findUnique(id: number): Post | null {
    return this.#rows.get(id) ?? null;
  }

  create(data: Omit<Post, "id" | "likes" | "createdAt"> & Partial<Pick<Post, "likes" | "createdAt">>): Post {
    const post = { likes: 0, createdAt: new Date(), ...data, id: this.#nextId++ };
    this.#rows.set(post.id, post);
    return post;
  }

  update(id: number, data: { [K in keyof Omit<Post, "id">]?: Post[K] | undefined }): Post | null {
    const post = this.#rows.get(id);
    if (!post) return null;
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) Object.assign(post, { [key]: value });
    }
    return post;
  }

  delete(id: number): boolean {
    return this.#rows.delete(id);
  }
}

declare global {
  namespace Forge {
    interface Deps {
      store: PostStore;
      /** Demo session (cookie `demo_user`), replaced by Better Auth in a later phase. */
      user: { name: string } | null;
    }
  }
}
