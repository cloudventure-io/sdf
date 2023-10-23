import mergeAllOff from "json-schema-merge-allof"
import { JSONSchema } from "json-schema-to-typescript"

/**
 * sanitizeSchema function copies the input schema and merges allOfs.
 *
 * @param schema
 * @returns
 */
export const sanitizeSchema = <T extends JSONSchema>(schema: T): T =>
  mergeAllOff<T>(schema, {
    ignoreAdditionalProperties: true,
  })
