import { readFileSync, writeFileSync } from 'fs'
import type OpenAI from 'openai'
import pLimit from 'p-limit'
import { DEFAULT_CHUNKED, DEFAULT_RETRIES, SYSTEM_PROMPT } from '../config/constants.ts'
import { translateByChunks, type ChunkInfo } from '../utils/markdown.ts'
import type { ProgressCallbacks } from '../utils/render.ts'
import { getOutputText } from './llm.ts'

function createTranslateFn(
  client: OpenAI,
  model: string,
  limit: ReturnType<typeof pLimit>,
) {
  return async (prompt: string) =>
    limit(async () => {
      let attempts = 0
      let lastError = ''

      while (attempts < DEFAULT_RETRIES) {
        attempts++
        try {
          const result = await getOutputText(client, model, SYSTEM_PROMPT, prompt)
          if (result) return result
        } catch (error) {
          lastError =
            error instanceof Error ? error.message : String(error)
        }
      }

      throw new Error(`已达到最大重试次数: ${lastError}`)
    })
}

export async function translateFiles(
  files: string[],
  client: OpenAI,
  model: string,
  queue: number,
  callbacks?: ProgressCallbacks,
) {
  const requestLimit = Math.max(1, queue)
  const workerCount = Math.min(requestLimit, files.length)

  if (workerCount === 0) {
    return
  }

  const limit = pLimit(requestLimit)
  let nextIndex = 0

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex
      nextIndex++

      if (currentIndex >= files.length) {
        return
      }

      const file = files[currentIndex]
      const content = readFileSync(file, 'utf-8')
      let hasStarted = false

      try {
        const translateFn = createTranslateFn(client, model, limit)
        let result: string

        if (DEFAULT_CHUNKED) {
          result = await translateByChunks(content, translateFn, {
            filePath: file,
            onChunksResolved: (chunks) => {
              hasStarted = true
              callbacks?.onFileStart(file, chunks)
            },
            onChunkStart: (chunk) => callbacks?.onChunkStart(file, chunk),
            onChunkDone: (chunk, outputTokens) =>
              callbacks?.onChunkComplete(file, chunk, outputTokens),
          })
        } else {
          const chunk: ChunkInfo = { index: 0, size: content.length }
          hasStarted = true
          callbacks?.onFileStart(file, [chunk])
          callbacks?.onChunkStart(file, chunk)
          const translated = await translateFn(content)
          result = translated.text
          callbacks?.onChunkComplete(file, chunk, translated.outputTokens)
        }

        if (!hasStarted) {
          callbacks?.onFileStart(file, [])
        }
        writeFileSync(file, result, 'utf-8')
        callbacks?.onFileComplete(file)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error)
        if (!hasStarted) {
          callbacks?.onFileStart(file, [])
        }
        callbacks?.onFileError(file, message)
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()))
}
