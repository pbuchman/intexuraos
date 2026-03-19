import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { OpenApiToolRegistry } from '../openapi-tool-registry.js';
import type { ServiceDefinition } from '../../config.js';
import { createTestLogger } from './test-helpers.js';

const TEST_OPENAPI_SPEC = {
  openapi: '3.1.1',
  info: { title: 'Test Service', version: '1.0.0' },
  paths: {
    '/internal/tasks': {
      get: {
        operationId: 'getRunningTasks',
        summary: 'Get running tasks',
        description: 'Returns all running tasks',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' }, required: false },
        ],
      },
      post: {
        operationId: 'createTask',
        summary: 'Create task',
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: 'string' } } },
            },
          },
        },
      },
    },
    '/public/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Health check',
      },
    },
  },
};

describe('OpenApiToolRegistry', () => {
  const testService: ServiceDefinition = {
    key: 'code-agent',
    name: 'Code Agent',
    url: 'http://code-agent:8128',
    openapiUrl: 'http://code-agent:8128/openapi.json',
  };

  let registry: OpenApiToolRegistry;

  beforeEach(() => {
    registry = new OpenApiToolRegistry({
      allowedServices: [testService],
      internalAuthToken: 'test-token',
      logger: createTestLogger() as never,
    });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('fetches and generates tools from OpenAPI spec', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    const tools = await registry.getToolsForService('code-agent');
    expect(tools.length).toBe(2);
    expect(tools[0]?.name).toBe('code_agent__getRunningTasks');
    expect(tools[1]?.name).toBe('code_agent__createTask');
  });

  it('filters to only /internal/* endpoints', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    const tools = await registry.getToolsForService('code-agent');
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('code_agent__getHealth');
  });

  it('caches specs - second call does not re-fetch', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .once()
      .reply(200, TEST_OPENAPI_SPEC);

    await registry.getToolsForService('code-agent');
    const tools = await registry.getToolsForService('code-agent');
    expect(tools.length).toBe(2);
  });

  it('returns empty for unknown service key', async () => {
    const tools = await registry.getToolsForService('unknown-service');
    expect(tools).toEqual([]);
  });

  it('handles service unreachable gracefully', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .replyWithError('Connection refused');

    const tools = await registry.getToolsForService('code-agent');
    expect(tools).toEqual([]);
  });

  it('handles non-200 response gracefully', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(500, 'Internal Server Error');

    const tools = await registry.getToolsForService('code-agent');
    expect(tools).toEqual([]);
  });

  it('getToolsForServices combines tools from multiple services', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    const tools = await registry.getToolsForServices(['code-agent']);
    expect(tools.length).toBe(2);
  });

  it('getToolsForServices returns empty for unknown service keys', async () => {
    const tools = await registry.getToolsForServices(['unknown-service']);
    expect(tools).toEqual([]);
  });

  it('listServiceTools returns service info with tool names', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    const services = await registry.listServiceTools();
    expect(services.length).toBe(1);
    expect(services[0]?.key).toBe('code-agent');
    expect(services[0]?.name).toBe('Code Agent');
    expect(services[0]?.tools.length).toBe(2);
    expect(services[0]?.tools[0]?.name).toBe('code_agent__getRunningTasks');
  });

  it('refreshAll clears cache and re-fetches', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    await registry.getToolsForService('code-agent');

    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, { ...TEST_OPENAPI_SPEC, paths: {} });

    await registry.refreshAll();
    const tools = await registry.getToolsForService('code-agent');
    expect(tools.length).toBe(0);
  });

  it('run callback makes HTTP call with X-Internal-Auth', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    nock('http://code-agent:8128')
      .get('/internal/tasks')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, JSON.stringify({ success: true, data: [] }));

    const tools = await registry.getToolsForService('code-agent');
    const getTasks = tools.find((t) => t.name === 'code_agent__getRunningTasks');
    if (getTasks === undefined) { expect(getTasks).toBeDefined(); return; }

    const result = await getTasks.run({});
    expect(result).toContain('success');
  });

  it('run callback sends query parameters', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    nock('http://code-agent:8128')
      .get('/internal/tasks')
      .query({ status: 'active' })
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, JSON.stringify({ tasks: [] }));

    const tools = await registry.getToolsForService('code-agent');
    const getTasks = tools.find((t) => t.name === 'code_agent__getRunningTasks');
    if (getTasks === undefined) { expect(getTasks).toBeDefined(); return; }

    const result = await getTasks.run({ status: 'active' });
    expect(result).toContain('tasks');
  });

  it('run callback sends body for POST', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    nock('http://code-agent:8128')
      .post('/internal/tasks', { name: 'new-task' })
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, JSON.stringify({ id: 'task-1' }));

    const tools = await registry.getToolsForService('code-agent');
    const createTask = tools.find((t) => t.name === 'code_agent__createTask');
    if (createTask === undefined) { expect(createTask).toBeDefined(); return; }

    const result = await createTask.run({ body: { name: 'new-task' } });
    expect(result).toContain('task-1');
  });

  it('respects allowedOperations filter', async () => {
    const serviceWithFilter: ServiceDefinition = {
      ...testService,
      allowedOperations: ['getRunningTasks'],
    };

    const filteredRegistry = new OpenApiToolRegistry({
      allowedServices: [serviceWithFilter],
      internalAuthToken: 'test-token',
      logger: createTestLogger() as never,
    });

    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    const tools = await filteredRegistry.getToolsForService('code-agent');
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe('code_agent__getRunningTasks');
  });

  it('generates description from summary and description', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    const tools = await registry.getToolsForService('code-agent');
    const getTasks = tools.find((t) => t.name === 'code_agent__getRunningTasks');
    if (getTasks === undefined) { expect(getTasks).toBeDefined(); return; }
    expect(getTasks.description).toContain('Get running tasks');
    expect(getTasks.description).toContain('Returns all running tasks');
  });

  it('extracts parameters from OpenAPI parameters', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    const tools = await registry.getToolsForService('code-agent');
    const getTasks = tools.find((t) => t.name === 'code_agent__getRunningTasks');
    if (getTasks === undefined) { expect(getTasks).toBeDefined(); return; }
    const params = getTasks.parameters as Record<string, unknown>;
    expect(params['type']).toBe('object');
    const properties = params['properties'] as Record<string, unknown>;
    expect(properties['status']).toEqual({ type: 'string' });
  });

  it('extracts body parameter from requestBody', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    const tools = await registry.getToolsForService('code-agent');
    const createTask = tools.find((t) => t.name === 'code_agent__createTask');
    if (createTask === undefined) { expect(createTask).toBeDefined(); return; }
    const params = createTask.parameters as Record<string, unknown>;
    const properties = params['properties'] as Record<string, unknown>;
    expect(properties['body']).toBeDefined();
    const required = params['required'] as string[];
    expect(required).toContain('body');
  });

  it('handles spec with no paths', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, { openapi: '3.1.1', info: { title: 'Empty', version: '1.0.0' } });

    const tools = await registry.getToolsForService('code-agent');
    expect(tools).toEqual([]);
  });

  it('handles spec with empty paths', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, { openapi: '3.1.1', info: { title: 'Empty', version: '1.0.0' }, paths: {} });

    const tools = await registry.getToolsForService('code-agent');
    expect(tools).toEqual([]);
  });

  it('skips operations without operationId', async () => {
    const specWithoutOpId = {
      openapi: '3.1.1',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/internal/items': {
          get: {
            summary: 'Get items',
          },
        },
      },
    };

    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, specWithoutOpId);

    const tools = await registry.getToolsForService('code-agent');
    expect(tools).toEqual([]);
  });

  it('handles path with path parameters in run callback', async () => {
    const specWithPathParam = {
      openapi: '3.1.1',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/internal/tasks/{taskId}': {
          get: {
            operationId: 'getTask',
            summary: 'Get a task by ID',
            parameters: [
              { name: 'taskId', in: 'path', schema: { type: 'string' }, required: true },
            ],
          },
        },
      },
    };

    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, specWithPathParam);

    nock('http://code-agent:8128')
      .get('/internal/tasks/task-123')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, JSON.stringify({ id: 'task-123' }));

    const tools = await registry.getToolsForService('code-agent');
    expect(tools.length).toBe(1);
    const tool = tools[0];
    if (tool === undefined) { expect(tool).toBeDefined(); return; }
    const result = await tool.run({ taskId: 'task-123' });
    expect(result).toContain('task-123');
  });

  it('encodes path parameters to prevent path traversal', async () => {
    const specWithPathParam = {
      openapi: '3.1.1',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/internal/tasks/{taskId}': {
          get: {
            operationId: 'getTask',
            summary: 'Get a task by ID',
            parameters: [
              { name: 'taskId', in: 'path', schema: { type: 'string' }, required: true },
            ],
          },
        },
      },
    };

    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, specWithPathParam);

    nock('http://code-agent:8128')
      .get('/internal/tasks/..%2F..%2Fadmin%2Fsecret')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, JSON.stringify({ blocked: true }));

    const tools = await registry.getToolsForService('code-agent');
    const tool = tools[0];
    if (tool === undefined) { expect(tool).toBeDefined(); return; }
    const result = await tool.run({ taskId: '../../admin/secret' });
    expect(result).toContain('blocked');
  });

  it('uses method and path as description fallback', async () => {
    const specNoDesc = {
      openapi: '3.1.1',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/internal/items': {
          delete: {
            operationId: 'deleteItems',
          },
        },
      },
    };

    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, specNoDesc);

    const tools = await registry.getToolsForService('code-agent');
    expect(tools.length).toBe(1);
    expect(tools[0]?.description).toBe('DELETE /internal/items');
  });

  it('skips non-object operations in paths', async () => {
    const specWithNonObject = {
      openapi: '3.1.1',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/internal/items': {
          get: {
            operationId: 'getItems',
            summary: 'Get items',
          },
          parameters: 'not-an-operation',
        },
      },
    };

    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, specWithNonObject);

    const tools = await registry.getToolsForService('code-agent');
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe('code_agent__getItems');
  });

  it('truncates response text exceeding 50000 characters via streaming', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    const largeBody = 'x'.repeat(60_000);
    nock('http://code-agent:8128')
      .get('/internal/tasks')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, largeBody);

    const tools = await registry.getToolsForService('code-agent');
    const getTasks = tools.find((t) => t.name === 'code_agent__getRunningTasks');
    if (getTasks === undefined) { expect(getTasks).toBeDefined(); return; }

    const result = await getTasks.run({});
    const expectedSuffix = `... [RESPONSE TRUNCATED - exceeded ${String(50_000)} byte limit]`;
    expect(result).toContain(expectedSuffix);
    expect(result.length).toBe(50_000 + expectedSuffix.length);
  });

  it('truncates response via fallback when response.body is null', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    // Fetch tools first with normal fetch so the spec is cached
    const tools = await registry.getToolsForService('code-agent');
    const getTasks = tools.find((t) => t.name === 'code_agent__getRunningTasks');
    if (getTasks === undefined) { expect(getTasks).toBeDefined(); return; }

    const largeBody = 'z'.repeat(60_000);
    nock('http://code-agent:8128')
      .get('/internal/tasks')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, largeBody);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const resp = await originalFetch(...args);
      const text = await resp.text();
      return {
        ok: resp.ok,
        status: resp.status,
        headers: resp.headers,
        body: null,
        text: () => Promise.resolve(text),
      } as unknown as Response;
    };

    try {
      const result = await getTasks.run({});
      const expectedSuffix = '... [RESPONSE TRUNCATED]';
      expect(result).toContain(expectedSuffix);
      expect(result.length).toBe(50_000 + expectedSuffix.length);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns full response via fallback when response.body is null and within limit', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    const tools = await registry.getToolsForService('code-agent');
    const getTasks = tools.find((t) => t.name === 'code_agent__getRunningTasks');
    if (getTasks === undefined) { expect(getTasks).toBeDefined(); return; }

    const smallBody = 'hello world';
    nock('http://code-agent:8128')
      .get('/internal/tasks')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, smallBody);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const resp = await originalFetch(...args);
      const text = await resp.text();
      return {
        ok: resp.ok,
        status: resp.status,
        headers: resp.headers,
        body: null,
        text: () => Promise.resolve(text),
      } as unknown as Response;
    };

    try {
      const result = await getTasks.run({});
      expect(result).toBe(smallBody);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not truncate response text within 50000 characters', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    const normalBody = 'y'.repeat(1000);
    nock('http://code-agent:8128')
      .get('/internal/tasks')
      .matchHeader('X-Internal-Auth', 'test-token')
      .reply(200, normalBody);

    const tools = await registry.getToolsForService('code-agent');
    const getTasks = tools.find((t) => t.name === 'code_agent__getRunningTasks');
    if (getTasks === undefined) { expect(getTasks).toBeDefined(); return; }

    const result = await getTasks.run({});
    expect(result).toBe(normalBody);
  });

  it('returns error string when fetch fails in run callback', async () => {
    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, TEST_OPENAPI_SPEC);

    nock('http://code-agent:8128')
      .get('/internal/tasks')
      .matchHeader('X-Internal-Auth', 'test-token')
      .replyWithError('ECONNREFUSED');

    const tools = await registry.getToolsForService('code-agent');
    const getTasks = tools.find((t) => t.name === 'code_agent__getRunningTasks');
    if (getTasks === undefined) { expect(getTasks).toBeDefined(); return; }

    const result = await getTasks.run({});
    expect(result).toContain('Error: Request to code-agent failed');
    expect(result).not.toContain('http://code-agent:8128');
  });

  it('handles parameter without schema', async () => {
    const specNoParamSchema = {
      openapi: '3.1.1',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/internal/items': {
          get: {
            operationId: 'getItems',
            summary: 'Get items',
            parameters: [
              { name: 'filter', in: 'query', required: true },
            ],
          },
        },
      },
    };

    nock('http://code-agent:8128')
      .get('/openapi.json')
      .reply(200, specNoParamSchema);

    const tools = await registry.getToolsForService('code-agent');
    expect(tools.length).toBe(1);
    const tool = tools[0];
    if (tool === undefined) { expect(tool).toBeDefined(); return; }
    const params = tool.parameters as Record<string, unknown>;
    const properties = params['properties'] as Record<string, unknown>;
    expect(properties['filter']).toEqual({ type: 'string' });
    const required = params['required'] as string[];
    expect(required).toContain('filter');
  });
});
