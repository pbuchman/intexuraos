// Test fixture: Missing .js extension (should be blocked)
import { helper } from './helper';
import { utils } from '../utils/index';

export function test() {
  return helper() + utils();
}
