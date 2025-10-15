import { read } from "rc9";
import fs from "fs";
import OpenAI from "openai";
import os from "os";
import path from "path";

const config = read({
  dir: path.join(os.homedir(), ".config", "llm-translator"),
  name: "app.conf",
});

export function getTargetFiles(
  targetPath: string,
  extensions: string[] = [".md", ".mdx"],
  ignoreDirs: string[] = ["node_modules", ".git", "dist", ".nuxt"]
): string[] {
  const isDir = fs.statSync(targetPath).isDirectory();
  let targetFiles: string[] = [];

  if (isDir) {
    fs.readdirSync(targetPath).forEach((file) => {
      const fullPath = path.join(targetPath, file);
      if (fs.statSync(fullPath).isDirectory()) {
        if (!ignoreDirs.includes(file)) {
          targetFiles = targetFiles.concat(
            getTargetFiles(fullPath, extensions, ignoreDirs)
          );
        }
      } else {
        const ext = path.extname(fullPath);
        if (extensions.includes(ext)) {
          targetFiles.push(fullPath);
        }
      }
    });
  } else {
    const ext = path.extname(targetPath);
    if (extensions.includes(ext)) {
      targetFiles.push(targetPath);
    }
  }

  return targetFiles.sort((a, b) => a.localeCompare(b));
}

export async function getTranslateContent(content: string): Promise<string> {
  try {
    const client = new OpenAI({
      apiKey: config.api_key,
      baseURL: config.base_url,
    });

    const response = await client.responses.create({
      model: config.model,
      instructions: config.prompt,
      input: content,
    });

    let result = response.output_text || "";
    let removedCodeBlock = false;

    if (result.startsWith("```")) {
      const firstNewlineIndex = result.indexOf("\n");
      if (firstNewlineIndex !== -1) {
        result = result.slice(firstNewlineIndex + 1);
        removedCodeBlock = true;
      }
    }

    if (removedCodeBlock && result.endsWith("```")) {
      result = result.slice(0, -3);
    }

    return result.trim();
  } catch (error) {
    return "";
  }
}
