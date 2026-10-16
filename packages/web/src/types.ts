import type { Endpoint, Repository } from "@forge/server";

type RepositoryOf<M> = { [K in keyof M]: M[K] extends Repository ? M[K] : never }[keyof M];

type RemoteCall<E> =
  E extends Endpoint<any, any, infer CallIn, any, infer Out, true>
    ? {} extends CallIn
      ? (input?: CallIn) => Promise<Out>
      : (input: CallIn) => Promise<Out>
    : never;

/** Browser-visible API of a repository module: only its `remote: true` functions. */
export type RemoteApi<M> = {
  [K in keyof RepositoryOf<M> as RepositoryOf<M>[K] extends { remote: true } ? K : never]: RemoteCall<RepositoryOf<M>[K]>;
};
