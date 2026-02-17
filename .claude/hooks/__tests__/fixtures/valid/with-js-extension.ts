// Test fixture: Proper .js extension (should pass)
import { helper } from './helper.js';
import { utils } from '../utils/index.js';
import data from './data.json';

export function test() {
  return helper() + utils() + data.value;
}
