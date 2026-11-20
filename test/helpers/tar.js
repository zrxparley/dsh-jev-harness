/**
 * 极简 ustar 构造器：只为造一个「像 GitHub source tarball」的输入，
 * 让技能目录刷新走真实 readTar + gunzip 路径，而不是绕过解析直接塞结果。
 *
 * 同时提供一个故意写坏 size 字段的开关（corruptSize），
 * 供后续「读到坏条目就静默截断」这类缺陷的回归测试使用。
 */
import zlib from 'node:zlib'

export function tarHeader(name, size, { corruptSize = false } = {}) {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  header.write('0000644\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(corruptSize ? 'zzzzzzzzzzz\0' : `${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  header.write('00000000000\0', 136, 12, 'ascii')
  header.write('        ', 148, 8, 'ascii')
  header.write('0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return header
}

export function tarEntry(name, content, opts) {
  const body = Buffer.from(content, 'utf8')
  const padLength = (512 - (body.length % 512)) % 512
  return Buffer.concat([tarHeader(name, body.length, opts), body, Buffer.alloc(padLength)])
}

/** entries: [{ path, content }] —— 返回 gzip 后的 tarball。 */
export function tarGz(entries) {
  return zlib.gzipSync(Buffer.concat(entries.map((entry) => tarEntry(entry.path, entry.content))))
}

/** 一个最小可用的 SKILL.md。 */
export function skillMarkdown(id, description) {
  return `---\nname: ${id.split('/')[1]}\ndescription: ${description}\n---\n# ${id}\n\nbody for ${id}\n`
}