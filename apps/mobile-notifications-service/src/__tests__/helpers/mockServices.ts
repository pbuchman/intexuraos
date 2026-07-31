import { setServices, type ServiceContainer } from '../../services.js';

export function setMockServices(overrides: Partial<ServiceContainer>): ServiceContainer {
  // Build a complete container by filling missing fields with throw-on-call stubs
  const stub = <T>(name: string): T =>
    new Proxy({} as object, {
      get(_t, prop) {
        return () => { throw new Error(`mockServices.${name}.${String(prop)} not configured`); };
      },
    }) as T;

  const container: ServiceContainer = {
    signatureConnectionRepository: overrides.signatureConnectionRepository ?? stub('signatureConnectionRepository'),
    notificationRepository: overrides.notificationRepository ?? stub('notificationRepository'),
    notificationFiltersRepository: overrides.notificationFiltersRepository ?? stub('notificationFiltersRepository'),
  };
  setServices(container);
  return container;
}
