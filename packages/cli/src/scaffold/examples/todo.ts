import { join } from "node:path";
import type { ResolvedConfig } from "@forge/core";
import { namesOf, type AppNames } from "../names.ts";
import { appUrls, emptyResult, wireNav, wireUrls, writeFiles, type WriteResult } from "../app.ts";

// `forge example todo`: a complete, working app to read and play with.
// Everything here is ordinary project code once written.

const MODELS = `// Todo model: one table, created by \`bun forge db migrate\`.
import { Model, model } from "forge/models";

export class Todo extends Model {
  static override model = {
    title: model.string({ maxLength: 200 }),
    done: model.boolean({ default: false }),
  };
  // createdAt, updatedAt, deletedAt (removing a todo sets deletedAt).
  static override timestamps = true;
}
`;

const SCHEMAS = `// What the todos API accepts and returns.
import { z } from "forge";

export const TodoId = z.object({ id: z.string() });

export const TodoInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
});

/** Replaces the editable fields (PUT). */
export const TodoUpdate = TodoId.extend({
  title: TodoInput.shape.title,
  done: z.boolean(),
});

export const TodoOutput = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  createdAt: z.date(),
});

export type Todo = z.infer<typeof TodoOutput>;
`;

function repository(db: boolean): string {
  const head = `// The todos API, mounted on /api/todos (urls.ts, then src/urls.ts). Every function is also
// callable from pages: \`await forge.todos.list()\` (import { forge } from "forge:router").
import { defineRepository, error, z } from "forge/server";
import { TodoId, TodoInput, TodoOutput, TodoUpdate${db ? "" : ", type Todo"} } from "./schemas.ts";
`;
  if (db) {
    return `${head}
const alive = { deletedAt: null } as const;

export const todos = defineRepository(({ get, post, put, del }) => ({
  // GET /api/todos
  list: get("/", {
    output: z.array(TodoOutput),
    remote: true,
    handler: ({ db }) => db.todo.findMany({ where: alive, orderBy: { createdAt: "desc" } }),
  }),

  // POST /api/todos  { "title": "..." }
  create: post("/", {
    input: TodoInput,
    output: TodoOutput,
    status: 201,
    remote: true,
    handler: ({ input, db }) => db.todo.create({ data: input }),
  }),

  // PUT /api/todos/:id  { "title": "...", "done": true }
  update: put("/:id", {
    input: TodoUpdate,
    output: TodoOutput,
    remote: true,
    handler: async ({ input: { id, ...data }, db }) => {
      const { count } = await db.todo.updateMany({ where: { id, ...alive }, data });
      if (!count) error(404, "Todo not found");
      return (await db.todo.findUnique({ where: { id } }))!;
    },
  }),

  // DELETE /api/todos/:id  (soft delete)
  remove: del("/:id", {
    input: TodoId,
    remote: true,
    handler: async ({ input, db }) => {
      const { count } = await db.todo.updateMany({ where: { id: input.id, ...alive }, data: { deletedAt: new Date() } });
      if (!count) error(404, "Todo not found");
    },
  }),
}));
`;
  }
  return `${head}
// No database in this project: kept in memory, emptied on restart.
const store = new Map<string, Todo>();

export const todos = defineRepository(({ get, post, put, del }) => ({
  // GET /api/todos
  list: get("/", {
    output: z.array(TodoOutput),
    remote: true,
    handler: () => [...store.values()].reverse(),
  }),

  // POST /api/todos  { "title": "..." }
  create: post("/", {
    input: TodoInput,
    output: TodoOutput,
    status: 201,
    remote: true,
    handler: ({ input }) => {
      const todo = { id: crypto.randomUUID(), done: false, createdAt: new Date(), ...input };
      store.set(todo.id, todo);
      return todo;
    },
  }),

  // PUT /api/todos/:id  { "title": "...", "done": true }
  update: put("/:id", {
    input: TodoUpdate,
    output: TodoOutput,
    remote: true,
    handler: ({ input: { id, ...data } }) => Object.assign(store.get(id) ?? error(404, "Todo not found"), data),
  }),

  // DELETE /api/todos/:id
  remove: del("/:id", {
    input: TodoId,
    remote: true,
    handler: ({ input }) => {
      if (!store.delete(input.id)) error(404, "Todo not found");
    },
  }),
}));
`;
}

const PAGE = `<!-- /todos: the list is rendered on the server (forge.todos.list()), then
     every action calls a remote function of src/apps/todos/repository.ts. -->
<script lang="ts">
  import { forge } from "forge:router";
  import { RemoteError } from "forge/web";

  let todos = $state(await forge.todos.list());
  let title = $state("");
  let message = $state("");
  const left = $derived(todos.filter((t) => !t.done).length);

  async function add(event: SubmitEvent) {
    event.preventDefault();
    try {
      todos = [await forge.todos.create({ title }), ...todos];
      title = "";
      message = "";
    } catch (e) {
      message = e instanceof RemoteError ? e.message : "Unexpected error";
    }
  }

  async function toggle(todo: (typeof todos)[number]) {
    const updated = await forge.todos.update({ id: todo.id, title: todo.title, done: !todo.done });
    todos = todos.map((t) => (t.id === updated.id ? updated : t));
  }

  async function remove(id: string) {
    await forge.todos.remove({ id });
    todos = todos.filter((t) => t.id !== id);
  }
</script>

<svelte:head><title>Todos</title></svelte:head>

<h1>Todos <small>{left} left</small></h1>

<form onsubmit={add}>
  <input bind:value={title} placeholder="What needs to be done?" />
  <button type="submit">Add</button>
</form>
{#if message}<p class="error">{message}</p>{/if}

<ul>
  {#each todos as todo (todo.id)}
    <li class:done={todo.done}>
      <label>
        <input type="checkbox" checked={todo.done} onchange={() => toggle(todo)} />
        {todo.title}
      </label>
      <button class="remove" onclick={() => remove(todo.id)} aria-label="Delete">×</button>
    </li>
  {:else}
    <li class="empty">Nothing to do.</li>
  {/each}
</ul>

<style>
  h1 small { font-size: 0.9rem; font-weight: 400; color: #6b6880; }
  form { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  form input { flex: 1; padding: 0.5rem; }
  ul { list-style: none; padding: 0; }
  li { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #eee; }
  li.done label { text-decoration: line-through; color: #8b8799; }
  .remove { border: none; background: none; cursor: pointer; font-size: 1.2rem; }
  .error { color: #b42318; }
</style>
`;

const ACCOUNT = `// Who is signed in (Better Auth). Better Auth itself answers on /api/auth.
import { defineRepository, z } from "forge/server";

export const account = defineRepository(({ get }) => ({
  // GET /api/account/me, and forge.account.me() in pages.
  me: get("/me", {
    output: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
    remote: true,
    handler: async ({ session }) => {
      const current = await session();
      return current ? { id: current.user.id, name: current.user.name, email: current.user.email } : null;
    },
  }),
}));
`;

const AUTH_CLIENT = `// Better Auth's Svelte client (sign up, sign in, sign out), created on first use.
import { createAuthClient } from "forge/auth/client";

let client: ReturnType<typeof createAuthClient> | undefined;
export function authClient() {
  return (client ??= createAuthClient());
}
`;

const LOGIN = `<!-- /login: sign up, sign in and sign out with Better Auth. -->
<script lang="ts">
  import { forge } from "forge:router";
  import { authClient } from "../../lib/auth-client.ts";

  const me = await forge.account.me();
  let name = $state("");
  let email = $state("");
  let password = $state("");
  let message = $state("");

  // The session changed: reload so layouts and pages read the new user.
  const reload = () => location.assign("/todos");

  async function signUp(event: SubmitEvent) {
    event.preventDefault();
    const { error } = await authClient().signUp.email({ name, email, password });
    if (error) message = error.message ?? "Sign up failed";
    else reload();
  }

  async function signIn() {
    const { error } = await authClient().signIn.email({ email, password });
    if (error) message = error.message ?? "Sign in failed";
    else reload();
  }

  async function signOut() {
    await authClient().signOut();
    reload();
  }
</script>

<svelte:head><title>Account</title></svelte:head>

{#if me}
  <h1>Hello {me.name}</h1>
  <button onclick={signOut}>Sign out</button>
{:else}
  <h1>Sign in</h1>
  <form onsubmit={signUp}>
    <input bind:value={name} placeholder="Name (sign up)" />
    <input type="email" bind:value={email} placeholder="Email" required />
    <input type="password" bind:value={password} placeholder="Password" required />
    <button type="submit">Create an account</button>
    <button type="button" onclick={signIn}>Sign in</button>
  </form>
  <p>{message}</p>
{/if}
`;

export const todo = {
  name: "todo",
  description: "Todo list: model, CRUD remote functions, page" + " (+ sign-in page with Better Auth)",
  async write(root: string, config: ResolvedConfig): Promise<WriteResult> {
    const todos: AppNames = namesOf("todos");
    const account: AppNames = namesOf("account");
    const app = join(config.apps, "todos");
    const files: Record<string, string> = {
      [join(app, "schemas.ts")]: SCHEMAS,
      [join(app, "repository.ts")]: repository(config.db !== null),
      [join(app, "urls.ts")]: appUrls(todos, config, false),
    };
    if (config.db) files[join(app, "models.ts")] = MODELS;
    if (config.web) files[join(config.web.dir, "todos/+page.svelte")] = PAGE;
    const withAuth = config.auth !== null && config.web !== null;
    if (withAuth) {
      files[join(config.apps, "account/repository.ts")] = ACCOUNT;
      files[join(config.apps, "account/urls.ts")] = appUrls(account, config, false);
      files[join(config.root, "src/lib/auth-client.ts")] = AUTH_CLIENT;
      files[join(config.web!.dir, "login/+page.svelte")] = LOGIN;
    }

    const result = emptyResult();
    await writeFiles(root, files, result);
    await wireUrls(root, config, todos, result);
    if (withAuth) await wireUrls(root, config, account, result);
    if (config.web) await wireNav(root, config, "/todos", "Todos", result);
    if (withAuth) await wireNav(root, config, "/login", "Account", result);
    return result;
  },
};

export const EXAMPLES = { todo } as const;
