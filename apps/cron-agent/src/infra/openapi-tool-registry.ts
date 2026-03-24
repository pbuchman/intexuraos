import { getErrorMessage, type Logger } from '@intexuraos/common-core';
import type { ToolDefinition } from '@intexuraos/llm-contract';
import type { ServiceDefinition } from '../config.js';
import type { ToolRegistry, ServiceToolInfo } from '../domain/ports/tool-registry.js';

export class OpenApiToolRegistry implements ToolRegistry {
  private cache = new Map<string, ToolDefinition[]>();
  private serviceMap: Map<string, ServiceDefinition>;

  constructor(private deps: {
    allowedServices: ServiceDefinition[];
    internalAuthToken: string;
    logger: Logger;
  }) {
    this.serviceMap = new Map(deps.allowedServices.map((s) => [s.key, s]));
    deps.logger.info(
      { serviceCount: this.serviceMap.size, serviceKeys: [...this.serviceMap.keys()] },
      'OpenApiToolRegistry initialized',
    );
  }

  async getToolsForService(serviceKey: string): Promise<ToolDefinition[]> {
    const service = this.serviceMap.get(serviceKey);
    if (service === undefined) {
      this.deps.logger.warn({ serviceKey }, 'Service not in allowlist');
      return [];
    }

    const cached = this.cache.get(serviceKey);
    if (cached !== undefined) {
      return cached;
    }

    const tools = await this.fetchAndGenerateTools(service);
    // Only cache non-empty results to avoid permanently disabling a service after transient failures
    if (tools.length > 0) {
      this.cache.set(serviceKey, tools);
    }
    return tools;
  }

  async getToolsForServices(serviceKeys: string[]): Promise<ToolDefinition[]> {
    const results = await Promise.all(serviceKeys.map((key) => this.getToolsForService(key)));
    return results.flat();
  }

  async listServiceTools(): Promise<ServiceToolInfo[]> {
    const results = await Promise.all(
      this.deps.allowedServices.map(async (service) => {
        const tools = await this.getToolsForService(service.key);
        return {
          key: service.key,
          name: service.name,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        };
      }),
    );
    return results;
  }

  async refreshAll(): Promise<void> {
    this.cache.clear();
    await Promise.all(this.deps.allowedServices.map((service) => this.getToolsForService(service.key)));
  }

  private async fetchAndGenerateTools(service: ServiceDefinition): Promise<ToolDefinition[]> {
    this.deps.logger.info(
      { service: service.key, openapiUrl: service.openapiUrl },
      'Fetching OpenAPI spec for service',
    );
    try {
      const response = await fetch(service.openapiUrl);
      if (!response.ok) {
        this.deps.logger.warn(
          { service: service.key, status: response.status },
          'Failed to fetch OpenAPI spec',
        );
        return [];
      }

      const spec = await response.json() as Record<string, unknown>;
      return this.generateToolsFromSpec(service, spec);
    } catch (error: unknown) {
      this.deps.logger.warn(
        { service: service.key, error: String(error) },
        'Error fetching OpenAPI spec',
      );
      return [];
    }
  }

  private generateToolsFromSpec(
    service: ServiceDefinition,
    spec: Record<string, unknown>,
  ): ToolDefinition[] {
    const paths = spec['paths'] as Record<string, Record<string, Record<string, unknown>>> | undefined;
    if (paths === undefined) {
      return [];
    }

    const tools: ToolDefinition[] = [];
    const serviceKeyNormalized = service.key.replace(/-/g, '_');

    for (const [path, methods] of Object.entries(paths)) {
      if (!path.startsWith('/internal/')) {
        continue;
      }

      for (const [method, rawOperation] of Object.entries(methods)) {
        const operation = rawOperation as unknown;
        if (typeof operation !== 'object' || operation === null) {
          continue;
        }
        const op = operation as Record<string, unknown>;

        const operationId = op['operationId'] as string | undefined;
        if (operationId === undefined) {
          continue;
        }

        if (
          service.allowedOperations !== undefined &&
          !service.allowedOperations.includes(operationId)
        ) {
          continue;
        }

        const toolName = `${serviceKeyNormalized}__${operationId}`;
        const summary = (op['summary'] as string | undefined) ?? '';
        const description = (op['description'] as string | undefined) ?? '';
        const toolDescription = [summary, description].filter(Boolean).join(' — ');

        const parameters = this.extractParameters(op);

        tools.push({
          name: toolName,
          description: toolDescription || `${method.toUpperCase()} ${path}`,
          parameters,
          run: this.createRunCallback(service, method, path),
        });
      }
    }

    if (tools.length === 0) {
      this.deps.logger.warn(
        { service: service.key },
        'Service produced zero tools — check operationId on /internal/* routes',
      );
    } else {
      this.deps.logger.info(
        { service: service.key, toolCount: tools.length },
        'Generated tools from OpenAPI spec',
      );
    }

    return tools;
  }

  private extractParameters(operation: Record<string, unknown>): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    const params = operation['parameters'] as Record<string, unknown>[] | undefined;
    if (params !== undefined) {
      for (const param of params) {
        const name = param['name'] as string;
        const schema = param['schema'] as Record<string, unknown> | undefined;
        properties[name] = schema ?? { type: 'string' };
        if (param['required'] === true) {
          required.push(name);
        }
      }
    }

    const requestBody = operation['requestBody'] as Record<string, unknown> | undefined;
    if (requestBody !== undefined) {
      const content = requestBody['content'] as Record<string, Record<string, unknown>> | undefined;
      const jsonContent = content?.['application/json'];
      /* v8 ignore start -- schema: nock OpenAPI mocks always include application/json with schema @preserve */
      if (jsonContent !== undefined) {
        const bodySchema = jsonContent['schema'] as Record<string, unknown> | undefined;
        if (bodySchema !== undefined) {
          /* v8 ignore stop @preserve */
          properties['body'] = bodySchema;
          required.push('body');
        }
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  private createRunCallback(
    service: ServiceDefinition,
    method: string,
    path: string,
  ): (args: Record<string, unknown>) => Promise<string> {
    const { internalAuthToken } = this.deps;
    const baseUrl = service.url;

    return async (args: Record<string, unknown>): Promise<string> => {
      let resolvedPath = path;
      const queryParams: Record<string, string> = {};
      let bodyData: unknown = undefined;

      for (const [key, value] of Object.entries(args)) {
        if (key === 'body') {
          bodyData = value;
        } else if (resolvedPath.includes(`{${key}}`)) {
          resolvedPath = resolvedPath.replace(`{${key}}`, encodeURIComponent(String(value)));
        } else {
          queryParams[key] = String(value);
        }
      }

      const queryString = Object.keys(queryParams).length > 0
        ? '?' + new URLSearchParams(queryParams).toString()
        : '';

      const url = `${baseUrl}${resolvedPath}${queryString}`;

      const headers: Record<string, string> = {
        'X-Internal-Auth': internalAuthToken,
        'Content-Type': 'application/json',
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => { controller.abort(); }, 30_000);
      try {
        const response = await fetch(url, {
          method: method.toUpperCase(),
          headers,
          signal: controller.signal,
          ...(bodyData !== undefined && { body: JSON.stringify(bodyData) }),
        });

        const MAX_RESPONSE_SIZE = 50_000;

        if (response.body === null) {
          const responseText = await response.text();
          return responseText.length > MAX_RESPONSE_SIZE
            ? responseText.slice(0, MAX_RESPONSE_SIZE) + `... [RESPONSE TRUNCATED]`
            : responseText;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let result = '';
        let truncated = false;

        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }

          result += decoder.decode(chunk.value as Uint8Array, { stream: true });

          if (result.length >= MAX_RESPONSE_SIZE) {
            truncated = true;
            result = result.slice(0, MAX_RESPONSE_SIZE);
            break;
          }
        }

        return truncated
          ? result + `... [RESPONSE TRUNCATED - exceeded ${String(MAX_RESPONSE_SIZE)} byte limit]`
          : result;
      } catch (fetchError: unknown) {
        return `Error: Request to ${service.key} failed — ${getErrorMessage(fetchError, 'unknown error')}`;
      } finally {
        clearTimeout(timeout);
      }
    };
  }
}
