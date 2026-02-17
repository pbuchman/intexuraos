// Test fixture: Suppressed pino import (should pass)
// @allow-pino-import -- testing escape hatch
import pino from 'pino';

const logger = pino({ name: 'test' });
