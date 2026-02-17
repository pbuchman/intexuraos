// Test fixture: Direct pino import (should be blocked)
import pino from 'pino';

const logger = pino({ name: 'test' });
logger.info('This should fail');
