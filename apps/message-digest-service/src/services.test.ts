import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from './config.js';
import {
  createServiceContainer,
  getServices,
  initServices,
  resetServices,
  setServices,
  type ServiceFactories,
} from './services.js';

describe('message-digest-service composition', () => {
  afterEach(() => {
    resetServices();
  });

  it('supplies every scaffold dependency from explicit factories', () => {
    const logger = { kind: 'logger' };
    const firestore = { kind: 'firestore' };
    const whatsappServiceClient = { kind: 'whatsapp-client' };
    const messageDigestStore = { kind: 'message-digest-store' };
    const messageDigestWhatsAppClient = { kind: 'message-digest-whatsapp-client' };
    const usageSink = { kind: 'usage-sink' };
    const llmClient = { kind: 'llm-client' };
    const messageDigestAggregator = { kind: 'message-digest-aggregator' };
    const pubsub = {
      kind: 'pubsub',
      topic: vi.fn((name: string) => ({ kind: 'topic', name })),
    };
    const messageDigestRunPublisher = { kind: 'message-digest-run-publisher' };
    const whatsappSendPublisher = { kind: 'whatsapp-send-publisher' };
    const runPreparationTokens = { kind: 'run-preparation-tokens' };
    const createFrozenPayloadPublisher = vi
      .fn()
      .mockReturnValueOnce(messageDigestRunPublisher)
      .mockReturnValueOnce(whatsappSendPublisher);
    const factories = {
      createLogger: vi.fn(() => logger as never),
      createFirestore: vi.fn(() => firestore as never),
      createWhatsAppServiceClient: vi.fn(() => whatsappServiceClient as never),
      createMessageDigestStore: vi.fn(() => messageDigestStore as never),
      createMessageDigestWhatsAppClient: vi.fn(() => messageDigestWhatsAppClient as never),
      createUsageSink: vi.fn(() => usageSink as never),
      createLlmClient: vi.fn<ServiceFactories['createLlmClient']>(() => llmClient as never),
      createMessageDigestAggregator: vi.fn<ServiceFactories['createMessageDigestAggregator']>(
        () => messageDigestAggregator as never
      ),
      createPubSub: vi.fn(() => pubsub as never),
      createFrozenPayloadPublisher,
      createRunPreparationTokens: vi.fn(() => runPreparationTokens as never),
    };

    const container = createServiceContainer(config(), factories);

    expect(container).toEqual({
      config: config(),
      logger,
      firestore,
      whatsappServiceClient,
      messageDigestStore,
      messageDigestWhatsAppClient,
      usageSink,
      messageDigestAggregator,
      pubsub,
      messageDigestRunPublisher,
      whatsappSendPublisher,
      runPreparationTokens,
    });
    expect(factories.createFirestore).toHaveBeenCalledWith('intexuraos-message-digest-mvp-local');
    expect(factories.createWhatsAppServiceClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:8113',
        internalAuthToken: 'synthetic-internal-token',
        logger,
      })
    );
    expect(factories.createMessageDigestStore).toHaveBeenCalledWith({
      firestore,
      cursorSecret: 'synthetic-internal-token',
    });
    expect(factories.createMessageDigestWhatsAppClient).toHaveBeenCalledWith(whatsappServiceClient);
    expect(factories.createMessageDigestAggregator).toHaveBeenCalledWith({
      createLlmClient: expect.any(Function),
      model: 'or:synthetic/model',
    });
    const aggregatorConfig = factories.createMessageDigestAggregator.mock.calls[0]?.[0];
    expect(aggregatorConfig?.createLlmClient('synthetic-user-001')).toBe(llmClient);
    expect(factories.createLlmClient).toHaveBeenCalledWith({
      apiKey: 'synthetic-openrouter-key',
      model: 'or:synthetic/model',
      userId: 'synthetic-user-001',
      logger,
      usageSink,
      ownerType: 'user',
    });
    expect(factories.createPubSub).toHaveBeenCalledWith({
      projectId: 'intexuraos-message-digest-mvp-local',
      apiEndpoint: '127.0.0.1:8102',
    });
    const boundedPublishOptions = {
      batching: { maxMessages: 1, maxMilliseconds: 1 },
      gaxOpts: { timeout: 30_000, retry: null },
    };
    expect(pubsub.topic).toHaveBeenNthCalledWith(
      1,
      'synthetic-message-digest-run',
      boundedPublishOptions
    );
    expect(pubsub.topic).toHaveBeenNthCalledWith(
      2,
      'synthetic-whatsapp-send',
      boundedPublishOptions
    );
    expect(createFrozenPayloadPublisher).toHaveBeenCalledTimes(2);
    expect(factories.createRunPreparationTokens).toHaveBeenCalledWith(
      'synthetic-internal-token'
    );
  });

  it('supports explicit test injection and fails closed before initialization', () => {
    expect(() => getServices()).toThrow('Message Digest service container is not initialized');

    const container = createServiceContainer(config(), {
      createLogger: (): never => ({}) as never,
      createFirestore: (): never => ({}) as never,
      createWhatsAppServiceClient: (): never => ({}) as never,
      createMessageDigestStore: (): never => ({}) as never,
      createMessageDigestWhatsAppClient: (): never => ({}) as never,
      createUsageSink: (): never => ({}) as never,
      createLlmClient: (): never => ({}) as never,
      createMessageDigestAggregator: (): never => ({}) as never,
      createPubSub: (): never => ({ topic: () => ({}) }) as never,
      createFrozenPayloadPublisher: (): never => ({}) as never,
      createRunPreparationTokens: (): never => ({}) as never,
    });
    setServices(container);
    expect(getServices()).toBe(container);

    resetServices();
    expect(() => getServices()).toThrow('Message Digest service container is not initialized');
  });

  it('initializes the singleton through the same complete composition path', () => {
    const factories = {
      createLogger: (): never => ({}) as never,
      createFirestore: (): never => ({}) as never,
      createWhatsAppServiceClient: (): never => ({}) as never,
      createMessageDigestStore: (): never => ({}) as never,
      createMessageDigestWhatsAppClient: (): never => ({}) as never,
      createUsageSink: (): never => ({}) as never,
      createLlmClient: (): never => ({}) as never,
      createMessageDigestAggregator: (): never => ({}) as never,
      createPubSub: (): never => ({ topic: () => ({}) }) as never,
      createFrozenPayloadPublisher: (): never => ({}) as never,
      createRunPreparationTokens: (): never => ({}) as never,
    };

    initServices(config(), factories);

    expect(getServices().config.storageMode).toBe('emulator');
  });
});

function config(): Config {
  return {
    port: 8135,
    gcpProjectId: 'synthetic-project',
    firestoreProjectId: 'intexuraos-message-digest-mvp-local',
    pubsubProjectId: 'intexuraos-message-digest-mvp-local',
    storageMode: 'emulator',
    firestoreEmulatorHost: '127.0.0.1:8101',
    pubsubEmulatorHost: '127.0.0.1:8102',
    authJwksUrl: 'https://auth.invalid/jwks',
    authIssuer: 'https://auth.invalid/',
    authAudience: 'urn:synthetic:api',
    internalAuthToken: 'synthetic-internal-token',
    whatsappServiceUrl: 'http://127.0.0.1:8113',
    llmUsageServiceUrl: 'http://127.0.0.1:8132',
    openRouterAppApiKey: 'synthetic-openrouter-key',
    digestLlmModel: 'or:synthetic/model',
    messageDigestRunTopic: 'synthetic-message-digest-run',
    whatsappSendTopic: 'synthetic-whatsapp-send',
    webAppUrl: 'http://127.0.0.1:3000',
    environment: 'development',
    runtime: 'dev',
  };
}
