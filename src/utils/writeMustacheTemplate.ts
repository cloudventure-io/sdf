import Mustache from "mustache"

import { fileExists } from "../utils/fileExists"
import { writeFile } from "./writeFile"

export interface writeMustacheTemplateOptions {
  template: string
  path: string
  overwrite?: boolean
  context?: {
    [k in string]: any
  }
}

export const writeMustacheTemplate = async ({
  template,
  path,
  overwrite,
  context,
}: writeMustacheTemplateOptions): Promise<void> => {
  if (!overwrite && (await fileExists(path))) {
    return
  }

  const content = Mustache.render(template, context, {}, { escape: v => v })
  await writeFile(path, content)
}
