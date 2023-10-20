import { mkdir, writeFile as writeFileOriginal } from "fs/promises"
import { dirname } from "path"

type args = Parameters<typeof writeFileOriginal>

/**
 * writeFile function writes a local file similary to builtin fs/promises/writeFile function,
 * but also creates the target directory if needed.
 * @param path
 * @param data
 * @param options
 * @returns
 */
export const writeFile = async (path: string, data: args[1], options?: args[2]) => {
  await mkdir(dirname(path), { recursive: true })

  return await writeFileOriginal(path, data, options)
}
