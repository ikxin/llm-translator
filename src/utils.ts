import { globSync } from 'glob'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import { statSync } from 'fs'

export function getAllFiles(filePath: string) {
  const isFile = statSync(filePath).isFile()
  const filePattern = isFile ? filePath : '**/*.{md,mdx}'

  const files = globSync(filePattern, {
    absolute: true,
    cwd: isFile ? process.cwd() : filePath,
    nodir: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
  })

  return files.sort((a, b) => a.localeCompare(b))
}

export async function getGitMergeFiles() {
  const git = simpleGit()
  const status = await git.status(['--porcelain'])

  const files = status.files
    .filter(
      (file) =>
        /\.(md|mdx)$/i.test(file.path) &&
        file.index === 'U' &&
        file.working_dir === 'U'
    )
    .map((file) => join(process.cwd(), file.path))

  return files.sort((a, b) => a.localeCompare(b))
}
