'use agent';
import { useModel } from '@flue/runtime';

export function Hello() {
  useModel('google/gemini-2.5-flash');
  return 'You are a helpful assistant. Keep replies under 15 words.';
}
