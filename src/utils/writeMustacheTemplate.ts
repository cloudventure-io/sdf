import { default as Handlebars } from "handlebars"

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

  const tpl = Handlebars.compile(template, { noEscape: true })
  const content = tpl(context)

  await writeFile(path, content)
}
