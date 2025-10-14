#!/usr/bin/env node

import { createInterface } from "readline";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { program } from "commander";
import { read, write } from "rc9";

const configDir = join(homedir(), ".config", "llm-translator");
const rl = createInterface({ input: process.stdin, output: process.stdout });

if (!existsSync(configDir)) {
  mkdirSync(configDir, { recursive: true });
}

const ask = (question: string, def = "") =>
  new Promise((resolve) => {
    rl.question(`${question} (默认: ${def}): `, (ans) => {
      resolve(ans.trim() || def);
    });
  });

program
  .name("llm-translator")
  .version("1.0.0")
  .description("基于 LLM 的命令行翻译工具");

program.command("init").action(async () => {
  const existing = read({ dir: configDir });

  const config = {
    OPENAI_BASE_URL: await ask(
      "OpenAI 接口地址",
      existing.OPENAI_BASE_URL || "https://api.openai.com/v1"
    ),
    OPENAI_MODEL: await ask("模型名称", existing.OPENAI_MODEL || "gpt-4o-mini"),
    OPENAI_API_KEY: await ask("API 密钥", existing.OPENAI_API_KEY || ""),
    OPENAI_SYSTEM_PROMPT: await ask(
      "系统提示词",
      existing.OPENAI_SYSTEM_PROMPT || "保持格式翻译为中文"
    ),
  };

  write(config, { dir: configDir, name: "app.conf" });
  console.log("配置已保存到", configDir);
  rl.close();
});

program.parse(process.argv);
