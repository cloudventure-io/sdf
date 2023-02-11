import * as Mustache from "mustache";
import { dirname } from "path";
// import { mkdir, writeFile } from "fs/promises";
// import { fileExists } from "./fileExists";

import { existsSync, writeFileSync, mkdirSync } from "fs";

export interface writeMustacheTemplateOptions {
  template: string;
  path: string;
  overwrite?: boolean;
  context: {
    [k in string]: any;
  };
}

export const writeMustacheTemplate = ({
  template,
  path,
  overwrite,
  context,
}: writeMustacheTemplateOptions) => {
  if (!overwrite && existsSync(path)) {
    return;
  }

  mkdirSync(dirname(path), { recursive: true });

  const content = Mustache.render(template, context, {}, { escape: (v) => v });
  writeFileSync(path, content);
};
