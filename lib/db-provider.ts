// lib/db-provider.ts
// Decides which database client a piece of code should use.
//
// On Node (local development, tests, a normal server) one client is shared by everything.
// In a Cloudflare Worker a connection may only be used by the request that opened it, so each
// request gets its own client. This file is pure on purpose so both rules can be tested without
// a database or a Worker.

export interface ClientProviderOptions<T extends object> {
  /** Builds a new client. Called once on Node, once per request in a Worker. */
  create: () => T;
  /**
   * An object that is the same for the whole of one request and different for every other request,
   * or null when the code is not running inside a per-request runtime (Node).
   */
  requestKey: () => object | null;
}

export function createClientProvider<T extends object>(options: ClientProviderOptions<T>): () => T {
  let shared: T | undefined;
  const perRequest = new WeakMap<object, T>();

  return () => {
    const key = options.requestKey();
    if (key === null) {
      shared ??= options.create();
      return shared;
    }
    let client = perRequest.get(key);
    if (!client) {
      client = options.create();
      perRequest.set(key, client);
    }
    return client;
  };
}

/**
 * A stand-in for a client that looks up the right real client every time it is used, so the rest of
 * the code can keep writing `prisma.user.findMany()` without caring where it runs.
 */
export function lazyClient<T extends object>(getClient: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const client = getClient();
      const value = Reflect.get(client, property, client);
      return typeof value === "function" ? value.bind(client) : value;
    },
    has(_target, property) {
      return Reflect.has(getClient(), property);
    },
  });
}
