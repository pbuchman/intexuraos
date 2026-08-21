interface RefreshRuntime {
  cacheStorage?: Pick<CacheStorage, 'delete' | 'keys'>;
  serviceWorker?: Pick<ServiceWorkerContainer, 'getRegistrations'>;
  reload: () => void;
}

export async function clearOfflineStateAndReload(runtime: RefreshRuntime): Promise<void> {
  const cacheNames = await runtime.cacheStorage?.keys();
  const registrations = await runtime.serviceWorker?.getRegistrations();

  await Promise.all([
    ...(cacheNames ?? []).map(async (name) => {
      await runtime.cacheStorage?.delete(name);
    }),
    ...(registrations ?? []).map(async (registration) => {
      await registration.unregister();
    }),
  ]);

  runtime.reload();
}
