/**
 * Generic dependency-injection container factory.
 *
 * Each app has a `services.ts` that wires its adapter implementations into a
 * `ServiceContainer` interface. Historically every service implemented the
 * lifecycle hooks (`init`, `get`, `set`, `reset`) by hand and they drifted
 * apart (`initializeServices` vs `initServices`, full vs partial overrides,
 * lazy lambdas, etc.). This factory captures the common pattern so per-service
 * `services.ts` files reduce to a typed factory + four named re-exports.
 *
 * @example
 * ```ts
 * interface ServiceContainer { repo: NoteRepository; }
 * function buildContainer(): ServiceContainer { return { repo: new FirestoreNoteRepository() }; }
 *
 * const handle = createServiceContainer<ServiceContainer>(buildContainer);
 * export const initServices = handle.init;
 * export const getServices = handle.get;
 * export const setServices = handle.set;
 * export const resetServices = handle.reset;
 * ```
 */

export interface ServiceContainerHandle<T, C = void> {
  /**
   * Build the container by invoking the factory. Optionally accepts a
   * configuration object that the factory may consume.
   */
  init: (config?: C) => void;
  /**
   * Returns the initialized container. Throws if {@link init} has not been
   * called (or {@link reset} was called since).
   */
  get: () => T;
  /**
   * Merge a partial override into the existing container — used by tests to
   * substitute fakes for specific dependencies. Throws if the container has
   * not been initialized.
   */
  set: (override: Partial<T>) => void;
  /**
   * Discard the current container so the next {@link get} throws and the next
   * {@link init} starts from a clean slate.
   */
  reset: () => void;
}

/**
 * Build a typed service-container handle whose lifecycle is driven by the
 * supplied factory.
 *
 * The factory is invoked exactly once per `init` call. Tests can swap in fake
 * adapters via `set(partial)` between `init` and the assertion.
 */
export function createServiceContainer<T, C = void>(
  factory: (config: C) => T
): ServiceContainerHandle<T, C> {
  let container: T | null = null;
  return {
    init: (config?: C): void => {
      container = factory(config as C);
    },
    get: (): T => {
      if (container === null) {
        throw new Error('Service container not initialized. Call init() first.');
      }
      return container;
    },
    set: (override: Partial<T>): void => {
      if (container === null) {
        throw new Error('Service container not initialized. Call init() first.');
      }
      container = { ...container, ...override };
    },
    reset: (): void => {
      container = null;
    },
  };
}
