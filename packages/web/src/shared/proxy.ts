// Browser-safe: used by both the server and the client `forge:router`.

/** Builds `forge.<app>.<fn>(input)` without knowing the app list at runtime. */
export function createRemoteProxy(call: (name: string, input: unknown) => Promise<unknown>): any {
  const apps = new Map<string, unknown>();
  return new Proxy(
    {},
    {
      get(_, app) {
        if (typeof app !== "string" || app === "then") return undefined;
        if (!apps.has(app)) {
          apps.set(
            app,
            new Proxy(
              {},
              {
                get: (_, fn) =>
                  typeof fn === "string" && fn !== "then" ? (input?: unknown) => call(`${app}.${fn}`, input) : undefined,
              },
            ),
          );
        }
        return apps.get(app);
      },
    },
  );
}
