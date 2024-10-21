import fs from "fs";
import { getTargetFiles, getTranslateContent } from "./utils";

const targetFiles = getTargetFiles(process.argv[2] || process.cwd());

async function translateFiles() {
  for (const file of targetFiles) {
    console.log(`正在翻译文件: ${file}`);
    const content = fs.readFileSync(file, 'utf-8');
    let translatedContent = '';
    let attempts = 0;
    const maxAttempts = 10;
    const startTime = Date.now();

    while (attempts < maxAttempts) {
      try {
        translatedContent = await getTranslateContent(content);
        if (translatedContent) {
          break;
        }
      } catch (error) {
        console.error(`翻译失败，正在重试 (${attempts + 1}/${maxAttempts})`);
      }
      attempts++;
    }

    const endTime = Date.now();
    const duration = endTime - startTime

    if (translatedContent) {
      fs.writeFileSync(file, translatedContent, 'utf-8');
      console.log(`文件 ${file} 翻译成功，耗时 ${duration.toFixed(2)} 毫秒`);
    } else {
      console.error(`文件 ${file} 翻译失败，已达到最大重试次数`);
    }
  }
}

translateFiles().catch(console.error);
