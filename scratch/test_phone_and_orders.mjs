import { normalizePhoneDigits, samePhone } from '../src/lib/supabase.js';

console.log('--- TESTING PHONE NORMALIZATION ---');
const testCases = [
  { input: '31988887777', expected: '5531988887777' },
  { input: '3188887777', expected: '5531988887777' },        // missing 9
  { input: '(31) 8888-7777', expected: '5531988887777' },    // formatted, missing 9
  { input: '553188887777', expected: '5531988887777' },      // 55 with 12 digits (missing 9)
  { input: '5531988887777', expected: '5531988887777' },     // 55 with 13 digits
];

let passCount = 0;
for (const tc of testCases) {
  const result = normalizePhoneDigits(tc.input);
  const match = result === tc.expected;
  if (match) passCount++;
  console.log(`Input: "${tc.input}" => Result: "${result}" [Expected: "${tc.expected}"] => ${match ? 'PASS' : 'FAIL'}`);
}

console.log('\n--- TESTING SAME PHONE COMPARISONS ---');
console.log('3188887777 vs 5531988887777:', samePhone('3188887777', '5531988887777') ? 'PASS' : 'FAIL');
console.log('553188887777 vs 31988887777:', samePhone('553188887777', '31988887777') ? 'PASS' : 'FAIL');
console.log('(31) 98888-7777 vs 3188887777:', samePhone('(31) 98888-7777', '3188887777') ? 'PASS' : 'FAIL');

if (passCount === testCases.length) {
  console.log('\nALL PHONE TESTS PASSED!');
} else {
  console.error('\nSOME PHONE TESTS FAILED!');
  process.exit(1);
}
