import Mustache from "mustache";
import { dirname } from "path";
import { writeFile, mkdir, open } from "fs/promises";
import { fileExists } from "../utils/fileExists";

export interface writeMustacheTemplateOptions {
  template: string;
  path: string;
  overwrite?: boolean;
  context: {
    [k in string]: any;
  };
}

export const writeMustacheTemplate = async ({
  template,
  path,
  overwrite,
  context,
}: writeMustacheTemplateOptions): Promise<void> => {
  if (!overwrite && (await fileExists(path))) {
    return;
  }

  await mkdir(dirname(path), { recursive: true });

  const content = Mustache.render(template, context, {}, { escape: (v) => v });
  await writeFile(path, content);
};
