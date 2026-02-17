import { globSync } from 'glob'
import { join } from 'path'
import { simpleGit } from 'simple-git'
import { statSync } from 'fs'
import type { OpenAI } from 'openai'

export function getAllFiles(filePath: string) {
  const isFile = statSync(filePath).isFile()
  const filePattern = isFile ? filePath : '**/*.{md,mdx}'

  const files = globSync(filePattern, {
    absolute: true,
    cwd: isFile ? process.cwd() : filePath,
    nodir: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/CHANGELOG.md'],
  })

  return files.sort((a, b) => a.localeCompare(b))
}

export async function getGitMergeFiles() {
  const git = simpleGit()
  const status = await git.status(['--porcelain'])

  const files = status.files
    .filter((file) => {
      const rules =
        (file.index === 'U' && file.working_dir === 'U') ||
        (file.index === 'A' && file.working_dir === ' ') ||
        (file.index === 'M' && file.working_dir === ' ')

      const isChangelog = /CHANGELOG\.md$/i.test(file.path)

      return /\.(md|mdx)$/i.test(file.path) && rules && !isChangelog
    })
    .map((file) => join(process.cwd(), file.path))

  return files.sort((a, b) => a.localeCompare(b))
}

export async function getOutputText(
  openai: OpenAI,
  model: string,
  content: string,
  prompt: string,
) {
  const response = await openai.responses.create({
    model: model,
    instructions: prompt,
    input: content,
  })

  return response.output_text
}
