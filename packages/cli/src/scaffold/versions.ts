/**
 * Versions written into new projects created outside the Forge repository
 * (inside it, projects use the workspace catalog). Kept equal to the root
 * catalog by a test.
 */
export const VERSIONS = {
  svelte: "5.57.2",
  prisma: "7.10.1",
  "@prisma/client": "7.10.1",
  "@prisma/adapter-pg": "7.10.1",
  "prisma-adapter-bun-sqlite": "0.8.0",
  typescript: "6.0.3",
  "@types/bun": "1.4.3",
  "svelte-check": "4.7.6",
} as const;

export type Dependency = keyof typeof VERSIONS;
