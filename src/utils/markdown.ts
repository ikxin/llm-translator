import type { Root, RootContent } from 'mdast'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdc from 'remark-mdc'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'

// 不需要翻译的节点类型（纯编程结构）
const NON_TRANSLATABLE_TYPES = new Set([
  'mdxjsEsm', // MDX import/export
  'mdxFlowExpression', // MDX JS 表达式
])

function isTranslatable(node: RootContent): boolean {
  return !NON_TRANSLATABLE_TYPES.has(node.type)
}

interface Chunk {
  start: number
  end: number
  translatable: boolean
}

export interface ChunkInfo {
  index: number
  size: number
}

export interface ChunkTranslationResult {
  text: string
  outputTokens: number
}

function createChunk(
  start: number,
  end: number,
  translatable: boolean,
): Chunk {
  return { start, end, translatable }
}

function splitIntoChunks(root: Root): Chunk[] {
  const chunks: Chunk[] = []
  let currentStart = -1
  let currentEnd = -1

  const pushCurrent = () => {
    if (currentStart < 0) return
    chunks.push(createChunk(currentStart, currentEnd, true))
    currentStart = -1
    currentEnd = -1
  }

  for (const node of root.children) {
    if (!node.position) continue

    const nodeStart = node.position.start.offset!
    const nodeEnd = node.position.end.offset!

    if (!isTranslatable(node)) {
      pushCurrent()
      chunks.push(createChunk(nodeStart, nodeEnd, false))
      continue
    }

    // 按二级标题切分：每个 ## 开启一个新片段。
    if (node.type === 'heading' && node.depth === 2) {
      pushCurrent()
    }

    if (currentStart < 0) {
      currentStart = nodeStart
    }

    currentEnd = nodeEnd
  }

  pushCurrent()

  return chunks
}

function createProcessor(filePath?: string) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml', 'toml'])

  if (filePath?.endsWith('.mdx')) {
    processor.use(remarkMdx)
  } else {
    processor.use(remarkMdc)
  }

  return processor.use(remarkStringify)
}

function createFallbackProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkStringify)
}

function parseMarkdown(content: string, filePath?: string): Root {
  const processor = createProcessor(filePath)

  try {
    return processor.parse(content) as Root
  } catch (error) {
    if (!filePath?.endsWith('.mdx')) {
      throw error
    }

    return createFallbackProcessor().parse(content) as Root
  }
}

function splitBoundaryWhitespace(text: string) {
  const leading = text.match(/^\s*/)?.[0] ?? ''
  const withoutLeading = text.slice(leading.length)
  const trailing = withoutLeading.match(/\s*$/)?.[0] ?? ''
  const body = withoutLeading.slice(0, withoutLeading.length - trailing.length)

  return { leading, body, trailing }
}

export function processChunkOutput(output: string): string {
  let result = output.trim()

  if (
    result.startsWith('```markdown') ||
    result.startsWith('```mdx') ||
    result.startsWith('```md')
  ) {
    const i = result.indexOf('\n')
    if (i !== -1) {
      result = result.slice(i + 1)
      if (result.endsWith('```')) {
        result = result.slice(0, -3).trimEnd()
      }
    }
  }

  return result
}

export async function translateByChunks(
  content: string,
  translateFn: (text: string) => Promise<ChunkTranslationResult>,
  options: {
    filePath?: string
    onChunksResolved?: (chunks: ChunkInfo[]) => void
    onChunkStart?: (chunk: ChunkInfo) => void
    onChunkDone?: (chunk: ChunkInfo, outputTokens: number) => void
  } = {},
): Promise<string> {
  const {
    filePath,
    onChunksResolved,
    onChunkStart,
    onChunkDone,
  } = options
  const tree = parseMarkdown(content, filePath)
  const chunks = splitIntoChunks(tree)

  if (chunks.length === 0) {
    return content
  }

  const translatableChunks = chunks.filter((c) => c.translatable)
  const chunkInfos = translatableChunks.map((chunk, index) => ({
    index,
    size: chunk.end - chunk.start,
  }))
  const chunkInfoByChunk = new Map<Chunk, ChunkInfo>()
  translatableChunks.forEach((chunk, index) => {
    chunkInfoByChunk.set(chunk, chunkInfos[index])
  })
  onChunksResolved?.(chunkInfos)

  const translatedChunks = await Promise.all(
    chunks.map(async (chunk) => {
      const chunkText = content.slice(chunk.start, chunk.end)

      if (!chunk.translatable) {
        return chunkText
      }

      const chunkInfo = chunkInfoByChunk.get(chunk)!
      onChunkStart?.(chunkInfo)
      const { leading, body, trailing } = splitBoundaryWhitespace(chunkText)

      if (body.length === 0) {
        onChunkDone?.(chunkInfo, 0)
        return chunkText
      }

      const translated = await translateFn(body)
      onChunkDone?.(chunkInfo, translated.outputTokens)
      return leading + processChunkOutput(translated.text) + trailing
    }),
  )

  const parts: string[] = []
  let lastEnd = 0

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    // 保留 chunk 之间的空白内容
    if (chunk.start > lastEnd) {
      parts.push(content.slice(lastEnd, chunk.start))
    }
    parts.push(translatedChunks[i])

    lastEnd = chunk.end
  }

  // 保留尾部内容（如末尾换行符）
  if (lastEnd < content.length) {
    parts.push(content.slice(lastEnd))
  }

  return parts.join('')
}
