import type { Instrumentation } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { DnsInstrumentation } from '@opentelemetry/instrumentation-dns';
import { NetInstrumentation } from '@opentelemetry/instrumentation-net';

export function getInstrumentations(): Instrumentation[] {
  return [
    new HttpInstrumentation(),
    new FastifyInstrumentation(),
    new PinoInstrumentation(),
    new UndiciInstrumentation(),
    new DnsInstrumentation(),
    new NetInstrumentation(),
  ];
}
