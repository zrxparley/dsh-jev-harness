/**
 * #20 residual: `method not allowed` must be localized, not raw English.
 * Acceptance check: index.js contains no English "method not allowed" string,
 * and a 405 response carries the Chinese text 方法不允许.
 * Run with: node test/method-locale-check.mjs <repo-root>
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2] || process.cwd()
const src = fs.readFileSync(path.join(root, 'index.js'), 'utf8')

const englishHits = (src.match(/error: 'method not allowed'/g) || []).length
if (englishHits > 0) {
  console.error(`FAIL: ${englishHits} raw English "method not allowed" string(s) still in index.js`)
  process.exit(1)
}
if (!src.includes('方法不允许')) {
  console.error('FAIL: no Chinese 方法不允许 text found in index.js')
  process.exit(1)
}
console.log('PASS: no raw English "method not allowed"; Chinese 方法不允许 present')
process.exit(0)
