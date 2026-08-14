import type { Root, RootContent } from 'mdast'
import {
  decode,
  encode,
  isWithinTokenLimit,
} from 'gpt-tokenizer/encoding/o200k_base'
import remarkFrontmatter from 'remark-frontmatter'
import remarkMdc from 'remark-mdc'
import remarkMdx from 'remark-mdx'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'
import { DEFAULT_MAX_CHUNK_SIZE } from '../config/constants.ts'

// 不需要翻译的节点类型（纯编程结构）
const NON_TRANSLATABLE_TYPES = new Set([
  'mdxjsEsm', // MDX import/export
  'mdxFlowExpression', // MDX JS 表达式
])

const TOKENIZER_OPTIONS = { disallowedSpecial: new Set<string>() }

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

function isWithinChunkLimit(text: string, maxChunkSize: number): boolean {
  const { body } = splitBoundaryWhitespace(text)
  return (
    isWithinTokenLimit(body, maxChunkSize, TOKENIZER_OPTIONS) !== false
  )
}

function findSafeTokenBoundary(text: string, maxChunkSize: number): number {
  const tokens = encode(text, TOKENIZER_OPTIONS)
  let tokenEnd = Math.min(tokens.length, maxChunkSize)

  while (tokenEnd > 0) {
    const prefix = decode(tokens.slice(0, tokenEnd))

    if (
      prefix.length > 0 &&
      text.startsWith(prefix) &&
      isWithinChunkLimit(prefix, maxChunkSize)
    ) {
      return prefix.length
    }

    tokenEnd--
  }

  throw new Error('无法在最大 token 限制内安全切分文档内容')
}

function splitLargeNode(
  content: string,
  start: number,
  end: number,
  maxChunkSize: number,
): Chunk[] {
  const chunks: Chunk[] = []
  let chunkStart = start

  while (chunkStart < end) {
    const remaining = content.slice(chunkStart, end)

    if (isWithinChunkLimit(remaining, maxChunkSize)) {
      chunks.push(createChunk(chunkStart, end, true))
      break
    }

    const boundary = findSafeTokenBoundary(remaining, maxChunkSize)
    chunks.push(createChunk(chunkStart, chunkStart + boundary, true))
    chunkStart += boundary
  }

  return chunks
}

function splitIntoChunks(
  content: string,
  root: Root,
  maxChunkSize = DEFAULT_MAX_CHUNK_SIZE,
): Chunk[] {
  const chunks: Chunk[] = []
  let currentChunk: Chunk | undefined

  const pushCurrentChunk = () => {
    if (!currentChunk) return
    chunks.push(currentChunk)
    currentChunk = undefined
  }

  for (const node of root.children) {
    if (!node.position) continue

    const nodeStart = node.position.start.offset!
    const nodeEnd = node.position.end.offset!

    if (!isTranslatable(node)) {
      pushCurrentChunk()
      chunks.push(createChunk(nodeStart, nodeEnd, false))
      continue
    }

    if (
      currentChunk &&
      isWithinChunkLimit(
        content.slice(currentChunk.start, nodeEnd),
        maxChunkSize,
      )
    ) {
      currentChunk.end = nodeEnd
      continue
    }

    pushCurrentChunk()

    const nodeText = content.slice(nodeStart, nodeEnd)
    if (isWithinChunkLimit(nodeText, maxChunkSize)) {
      currentChunk = createChunk(nodeStart, nodeEnd, true)
      continue
    }

    const nodeChunks = splitLargeNode(
      content,
      nodeStart,
      nodeEnd,
      maxChunkSize,
    )
    chunks.push(...nodeChunks.slice(0, -1))
    currentChunk = nodeChunks.at(-1)
  }

  pushCurrentChunk()

  return chunks
}

function createMdcProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkMdc)
    .use(remarkStringify)
}

function createMdxProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkMdx)
    .use(remarkStringify)
}

function createFallbackProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkStringify)
}

function hasMdxComponentSyntax(content: string): boolean {
  return /(?:^|\n)[\t ]*<\/?[A-Z][A-Za-z0-9_.:-]*(?=[\s/>])/.test(content)
}

function parseMarkdown(content: string, filePath?: string): Root {
  const shouldUseMdx =
    filePath?.toLowerCase().endsWith('.mdx') || hasMdxComponentSyntax(content)

  if (!shouldUseMdx) {
    return createMdcProcessor().parse(content) as Root
  }

  try {
    return createMdxProcessor().parse(content) as Root
  } catch {
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
    maxChunkSize?: number
  } = {},
): Promise<string> {
  const {
    filePath,
    onChunksResolved,
    onChunkStart,
    onChunkDone,
    maxChunkSize = DEFAULT_MAX_CHUNK_SIZE,
  } = options
  const tree = parseMarkdown(content, filePath)
  const chunks = splitIntoChunks(content, tree, maxChunkSize)

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
