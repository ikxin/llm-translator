import path from "path";
import fs from "fs";
import openai from "openai";

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
  const client = new openai({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  });

  try {
    const response = await client.chat.completions.create({
      messages: [
        { role: "system", content: process.env.OPENAI_SYSTEM_PROMPT! },
        { role: "user", content },
      ],
      model: process.env.OPENAI_MODEL!,
    });

    let result = response.choices[0].message.content || "";
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
