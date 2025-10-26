import { statSync } from 'fs'
import { globSync } from 'glob'

export function getAllFiles(filePath: string) {
  const isFile = statSync(filePath).isFile()

  return globSync(isFile ? filePath : '**/*.{md,mdx}', {
    absolute: true,
    cwd: isFile ? process.cwd() : filePath,
    nodir: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
  }).sort((a, b) => a.localeCompare(b))
}
