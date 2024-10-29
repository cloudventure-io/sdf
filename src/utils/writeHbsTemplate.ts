import { default as Handlebars } from "handlebars"

import { fileExists } from "./fileExists"
import { writeFile } from "./writeFile"

export interface writeHbsTemplateOptions {
  template: string
  path: string
  overwrite?: boolean
  context?: {
    [k in string]: any
  }
}

export const writeHbsTemplate = async ({
  template,
  path,
  overwrite,
  context,
}: writeHbsTemplateOptions): Promise<void> => {
  if (!overwrite && (await fileExists(path))) {
    return
  }

  const tpl = Handlebars.compile(template, { noEscape: true })
  const content = tpl(context)

  await writeFile(path, content)
}
