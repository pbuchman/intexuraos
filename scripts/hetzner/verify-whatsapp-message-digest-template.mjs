#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GRAPH_API_BASE = 'https://graph.facebook.com/v22.0';
const TEMPLATE_NAME = 'intexuraos_message_digest_v1';
const TEMPLATE_LANGUAGE = 'en_US';
const TEMPLATE_CATEGORY = 'UTILITY';
const TEMPLATE_STATUS = 'APPROVED';
const TEMPLATE_BODY_TEXT =
  'Your WhatsApp digest is ready: {{1}}\n\n{{2}}\n\nOpen the full digest for details.';
const TEMPLATE_BUTTON_TEXT = 'View digest';
const TEMPLATE_BUTTON_URL = 'https://intexuraos.cloud/{{1}}';
const MAX_RESPONSE_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const SAFE_ERROR_CODE = 'MESSAGE_DIGEST_PROVIDER_TEMPLATE_NOT_READY';

export async function verifyWhatsAppMessageDigestTemplate(options = {}) {
  let timeoutId;
  try {
    const environment = options.environment ?? process.env;
    const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
    const accessToken = requiredString(
      environment.INTEXURAOS_WHATSAPP_ACCESS_TOKEN,
      /^.{1,8192}$/u
    );
    const wabaId = requiredString(environment.INTEXURAOS_WHATSAPP_WABA_ID, /^[0-9]{5,32}$/u);
    if (typeof fetchImplementation !== 'function') throw safeError();

    const url = new URL(`${GRAPH_API_BASE}/${wabaId}/message_templates`);
    url.searchParams.set('name', TEMPLATE_NAME);
    url.searchParams.set('fields', 'name,language,status,category,components');
    url.searchParams.set('limit', '100');

    const abortController = new AbortController();
    timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
    const response = await fetchImplementation(url, {
      method: 'GET',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      signal: abortController.signal,
    });
    if (!response?.ok) throw safeError();
    const contentLength = response.headers?.get('content-length');
    if (
      contentLength !== null &&
      contentLength !== undefined &&
      (!/^[0-9]+$/u.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)
    ) {
      throw safeError();
    }
    const responseText = await readBoundedResponseText(response);

    const payload = JSON.parse(responseText);
    if (!isRecord(payload) || !Array.isArray(payload.data)) throw safeError();
    const matchingTemplates = payload.data.filter(
      (template) =>
        isRecord(template) &&
        template.name === TEMPLATE_NAME &&
        template.language === TEMPLATE_LANGUAGE
    );
    if (matchingTemplates.length !== 1 || !isExpectedTemplate(matchingTemplates[0])) {
      throw safeError();
    }

    return {
      ok: true,
      templateName: TEMPLATE_NAME,
      language: TEMPLATE_LANGUAGE,
      status: TEMPLATE_STATUS,
    };
  } catch {
    throw safeError();
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function readBoundedResponseText(response) {
  if (response.body === null || response.body === undefined) {
    const responseText = await response.text();
    if (new TextEncoder().encode(responseText).byteLength > MAX_RESPONSE_BYTES) throw safeError();
    return responseText;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let cancelled = false;
  let completed = false;
  let responseText = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        completed = true;
        return `${responseText}${decoder.decode()}`;
      }
      if (!(chunk.value instanceof Uint8Array)) throw safeError();
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAX_RESPONSE_BYTES) {
        cancelled = true;
        await reader.cancel();
        throw safeError();
      }
      responseText += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    if (!completed && !cancelled) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the fixed safe failure from the original read.
      }
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function isExpectedTemplate(template) {
  if (
    !isRecord(template) ||
    template.status !== TEMPLATE_STATUS ||
    template.category !== TEMPLATE_CATEGORY ||
    !Array.isArray(template.components) ||
    template.components.length !== 2
  ) {
    return false;
  }
  const [body, buttons] = template.components;
  if (
    !isRecord(body) ||
    body.type !== 'BODY' ||
    body.text !== TEMPLATE_BODY_TEXT ||
    !isRecord(buttons) ||
    buttons.type !== 'BUTTONS' ||
    !Array.isArray(buttons.buttons) ||
    buttons.buttons.length !== 1
  ) {
    return false;
  }
  const variables = body.text.match(/\{\{[0-9]+\}\}/gu);
  if (
    variables === null ||
    variables.length !== 2 ||
    variables[0] !== '{{1}}' ||
    variables[1] !== '{{2}}'
  ) {
    return false;
  }
  const button = buttons.buttons[0];
  return (
    isRecord(button) &&
    button.type === 'URL' &&
    button.text === TEMPLATE_BUTTON_TEXT &&
    button.url === TEMPLATE_BUTTON_URL
  );
}

function requiredString(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw safeError();
  return value;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeError() {
  return new Error(SAFE_ERROR_CODE);
}

const entryPath = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (entryPath !== null && entryPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyWhatsAppMessageDigestTemplate();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(`${SAFE_ERROR_CODE}\n`);
    process.exitCode = 1;
  }
}
