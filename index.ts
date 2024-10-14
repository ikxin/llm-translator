import OpenAI from "openai";
import fs from "fs";
import path from "path";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API,
  baseURL: process.env.OPENAI_BASE_URL,
});

const extname = [".mdx", ".md"];
const prompt =
  "将以下 markdown 格式的文档翻译成中文，请严格按照原文 markdown 格式";

async function translate(content: string) {
  try {
    const response = await openai.chat.completions.create({
      messages: [
        { role: "system", content: prompt },
        { role: "user", content },
      ],
      model: process.env.OPENAI_MODEL!,
      max_tokens: 8 * 1024,
    });
    return response.choices[0].message.content || "";
  } catch (error) {
    return "";
  }
}

async function main(targetPath: string) {
  const isDir = fs.statSync(targetPath).isDirectory();

  const files = isDir
    ? fs.readdirSync(targetPath).map((file) => path.join(targetPath, file))
    : [targetPath];

  for (const filePath of files) {
    const ext = path.extname(filePath);
    if (extname.includes(ext)) {
      const startTime = Date.now();
      const content = fs.readFileSync(filePath, "utf8");
      const translated = await translate(content);
      fs.writeFileSync(filePath, translated, "utf8");
      const countTime = Date.now() - startTime;
      console.log(`已翻译：${path.basename(filePath)}，耗时：${countTime}ms`);
    } else {
      console.log(`未翻译：${path.basename(filePath)}`);
    }
  }
}

await main(process.argv[2] || process.cwd());
