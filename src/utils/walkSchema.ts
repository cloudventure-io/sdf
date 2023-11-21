import { OpenAPIV3 } from "openapi-types"

export interface schemaHandlerOptions {
  trace: string

  schema: OpenAPIV3.SchemaObject
  parent?: OpenAPIV3.SchemaObject
}

export const walkSchema = (
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  handler: (options: schemaHandlerOptions) => OpenAPIV3.SchemaObject | void,
  trace?: string,
  bottomUp?: boolean,
): OpenAPIV3.SchemaObject => doWalkSchema(schema, handler, trace || "/", new Set(), undefined, bottomUp)

const doWalkSchema = (
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  handler: (options: schemaHandlerOptions) => OpenAPIV3.SchemaObject | void,
  trace: string,
  visited: Set<OpenAPIV3.SchemaObject>,
  parent?: OpenAPIV3.SchemaObject,
  bottomUp?: boolean,
): OpenAPIV3.SchemaObject => {
  if ("$ref" in schema) {
    throw new Error(`unexpected $ref at ${trace}, schema must be dereferenced`)
  } else if (visited.has(schema)) {
    return schema
  }

  let s: OpenAPIV3.SchemaObject | undefined | void
  if (!bottomUp) {
    s = handler({ trace, schema, parent })
  }
  s ??= schema

  if (s.type === "array" && s.items) {
    s.items = doWalkSchema(s.items, handler, `${trace}/items`, visited, s, bottomUp)
  }

  if (s.properties) {
    for (const key in s.properties) {
      s.properties[key] = doWalkSchema(
        s.properties[key],
        handler,
        `${trace}/properties/${encodeURIComponent(key)}`,
        visited,
        s,
        bottomUp,
      )
    }
  }

  if (s.allOf) {
    for (const key in s.allOf) {
      s.allOf[key] = doWalkSchema(s.allOf[key], handler, `${trace}/allOf/${key}`, visited, s, bottomUp)
    }
  }
  if (s.oneOf) {
    for (const key in s.oneOf) {
      s.oneOf[key] = doWalkSchema(s.oneOf[key], handler, `${trace}/oneOf/${key}`, visited, s, bottomUp)
    }
  }
  if (s.anyOf) {
    for (const key in s.anyOf) {
      s.anyOf[key] = doWalkSchema(s.anyOf[key], handler, `${trace}/anyOf/${key}`, visited, s, bottomUp)
    }
  }

  if (bottomUp) {
    s = handler({ trace, schema, parent }) ?? schema
  }

  return s
}
