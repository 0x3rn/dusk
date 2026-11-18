// lib/lazy-instance.ts
// A stand-in object that creates the real one the first time it is used, and looks it up again on
// every use. Importing a module that exports one never runs the setup, so a build with no secrets
// (a clean CI checkout, Cloudflare's builder) can still load every route.

export function lazyInstance<T extends object>(getInstance: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const instance = getInstance();
      const value = Reflect.get(instance, property, instance);
      return typeof value === "function" ? value.bind(instance) : value;
    },
    has(_target, property) {
      return Reflect.has(getInstance(), property);
    },
  });
}
