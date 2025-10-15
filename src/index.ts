#!/usr/bin/env node

import { homedir } from "os";
import { join } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { program } from "commander";
import { read, write } from "rc9";
import { getTargetFiles, getTranslateContent } from "../utils.ts";

const configDir = join(homedir(), ".config", "llm-translator");

if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true });
}

program
  .name("llm-translator")
  .version("1.0.0")
  .description("基于 LLM 的命令行翻译工具");

program
  .argument("[filePath]", "需要翻译的文件路径")
  .action(async (filePath) => {
    if (!filePath) {
      console.error("请提供需要翻译的文件路径");
      console.log("使用方法: llm-translator <文件路径>");
      process.exit(1);
    }

    for (const file of getTargetFiles(filePath)) {
      console.log(`正在翻译文件: ${file}`);
      const content = readFileSync(file, "utf-8");
      let translatedContent = "";
      let attempts = 0;
      const maxAttempts = 10;
      const startTime = Date.now();

      while (attempts < maxAttempts) {
        console.log(`尝试翻译文件: ${file} (尝试次数: ${attempts + 1})`);

        try {
          translatedContent = await getTranslateContent(content);
          if (translatedContent) {
            console.log(`翻译成功，正在写入文件: ${file}`);
            break;
          }
        } catch (error) {
          console.error(`翻译失败，正在重试 (${attempts + 1}/${maxAttempts})`);
        }
        attempts++;
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      if (translatedContent) {
        writeFileSync(file, translatedContent, "utf-8");
        console.log(`文件 ${file} 翻译成功，耗时 ${duration.toFixed(2)} 毫秒`);
      } else {
        console.error(`文件 ${file} 翻译失败，已达到最大重试次数`);
      }
    }
  });

program.command("init").action(() => {
  const config = {
    api_key: "",
    base_url: "",
    model: "",
    prompt: "",
  };

  write(config, { dir: configDir, name: "app.conf" });
  console.log("配置已保存到", configDir);
});

program.parse(process.argv);
