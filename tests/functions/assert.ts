// Tiny assertion helpers (the jsr registry is not reachable from every build machine).
export function assert(cond: unknown, msg = "assertion failed"): asserts cond { if (!cond) throw new Error(msg); }
export function assertEquals(a: unknown, b: unknown, msg?: string) {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg ?? "not equal"}: ${x} !== ${y}`);
}
// deno-lint-ignore no-explicit-any
export async function assertRejects(fn: () => Promise<unknown>, cls?: any, includes?: string) {
  try { await fn(); } catch (e) {
    if (cls && !(e instanceof cls)) throw new Error(`wrong error type: ${(e as Error).constructor.name} ${(e as Error).message}`);
    if (includes && !(e as Error).message.includes(includes)) throw new Error(`message "${(e as Error).message}" lacks "${includes}"`);
    return e;
  }
  throw new Error("expected rejection");
}
