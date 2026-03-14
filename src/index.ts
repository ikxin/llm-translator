#!/usr/bin/env node

import openai from 'openai'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { program } from 'commander'
import { read, write } from 'rc9'
import {
  getAllFiles,
  getGitMergeFiles,
  getOutputText,
  resolveConflictsWithTheirs,
} from './utils.ts'
import { prompt } from './prompt.ts'

const configDir = join(homedir(), '.config', 'llm-translator')

if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true })
}

const config = read({
  dir: configDir,
  name: 'app.conf',
})

const client = new openai({
  apiKey: config.api_key,
  baseURL: config.base_url,
})

program
  .name('llm-translator')
  .version('1.0.0')
  .description('基于 LLM 的命令行翻译工具')

program
  .argument('[filePath]', '需要翻译的文件路径')
  .action(async (filePath) => {
    if (!filePath) {
      console.error('请提供需要翻译的文件路径')
      console.log('使用方法: llm-translator <文件路径>')
      process.exit(1)
    }

    for (const file of getAllFiles(filePath)) {
      console.time('任务耗时')

      const content = readFileSync(file, 'utf-8')

      let result = ''
      let attempts = 0

      while (attempts < 10) {
        console.log(`第 ${attempts + 1} 次执行 ${file}`)

        try {
          result = await getOutputText(
            client,
            config.model,
            content,
            prompt.translate,
          )

          if (result) break
        } catch (error) {
          console.error(`正在重试`)
        }
        attempts++
      }

      if (result) {
        writeFileSync(file, result, 'utf-8')
        console.timeEnd('任务耗时')
      } else {
        console.error(`文件 ${file} 翻译失败，已达到最大重试次数`)
      }
    }
  })

program.command('init').action(() => {
  const config = {
    api_key: '',
    base_url: '',
    model: '',
  }

  write(config, { dir: configDir, name: 'app.conf' })
  console.log('配置已保存到', configDir)
})

program.command('merge').action(async () => {
  const files = await getGitMergeFiles()

  if (files.length === 0) {
    console.log('没有需要处理的文件')
    return
  }

  console.log(`正在使用 git 解决 ${files.length} 个文件的冲突...`)
  await resolveConflictsWithTheirs(files)
  console.log('冲突已解决，开始翻译...')

  for (const file of files) {
    console.time('任务耗时')

    const content = readFileSync(file, 'utf-8')

    let result = ''
    let attempts = 0

    while (attempts < 10) {
      console.log(`第 ${attempts + 1} 次执行 ${file}`)

      try {
        result = await getOutputText(
          client,
          config.model,
          content,
          prompt.translate,
        )

        if (result) break
      } catch (error) {
        console.error(`正在重试`)
      }
      attempts++
    }

    if (result) {
      writeFileSync(file, result, 'utf-8')
      console.timeEnd('任务耗时')
    } else {
      console.error(`文件 ${file} 翻译失败，已达到最大重试次数`)
    }
  }
})

program.parse(process.argv)
