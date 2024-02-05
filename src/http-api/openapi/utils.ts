import { DocumentTrace } from "./DocumentTrace"
import { BundledDocument, DereferencedDocument } from "./types"

type Defined<T> = T extends undefined ? never : T
type DefinedValue<T> = Defined<Defined<T>[keyof Defined<T>]>

/**
 * map function applies the callback to every element of the provided object.
 * If input is undefined, the result is undefined.
 * If callback is undefined, the result is a shallow copy of the input with undefined values removed.
 */
export const map = <In extends object | undefined, Out, Ret = In extends object ? Record<string, Out> : undefined>(
  input: In,
  cb?: (value: DefinedValue<In>, key: string) => Out,
): Ret => {
  let res: Ret = undefined as any

  if (input !== undefined) {
    let entries = Object.entries(input).filter(([, value]) => value !== undefined)
    if (cb) {
      entries = entries.map(([key, value]) => [key, cb(value, key)])
    }
    res = Object.fromEntries(entries) as Ret
  }

  return res
}

/**
 * Dereferences the given item.
 *
 * ⚠️ The item must contain only internal references. This can ba achieved by using `SwaggerParser.bundle()` function.
 *
 * @param document The OpenAPI document
 *
 * @returns The dereferenced item
 */
export function dereference(
  document: BundledDocument,
  _ctx?: {
    item: unknown
    visited: Map<unknown, unknown>
    trace: DocumentTrace
  },
): DereferencedDocument {
  if (!_ctx) {
    _ctx = {
      item: document,
      visited: new Map(),
      trace: new DocumentTrace(document["x-sdf-source"]),
    }
  }
  const visited = _ctx.visited
  const trace = _ctx.trace
  const item = _ctx.item

  if (visited.has(item)) {
    return visited.get(item) as DereferencedDocument
  }

  let result = item

  if (item && typeof item === "object" && "$ref" in item && typeof item.$ref === "string") {
    const ref = item.$ref

    if (!ref.startsWith("#/")) {
      throw new Error(`Only internal references are supported at '${trace}', '${ref}' is not internal`)
    }

    const paths = ref.slice(2).split("/")

    result = paths.map(decodeURIComponent).reduce((acc, path) => {
      if (path in acc) {
        return acc[path]
      } else {
        throw new Error(`Invalid reference '${ref}' at ${trace}`)
      }
    }, document)

    visited.set(item, result)

    return dereference(document, {
      item: result,
      visited,
      trace: new DocumentTrace(document["x-sdf-source"]).append(ref),
    })
  } else if (Array.isArray(item)) {
    item.forEach((value, index) => {
      item[index] = dereference(document, { item: value, visited, trace: trace.append(index) })
    })
  } else if (item && typeof item === "object") {
    Object.entries(item).forEach(([key, value]: [string, unknown]) => {
      item[key] = dereference(document, { item: value, visited, trace: trace.append(key) })
    })
  }

  if (typeof item === "object" && item !== null) {
    visited.set(item, result)
  }

  return result as DereferencedDocument
}
