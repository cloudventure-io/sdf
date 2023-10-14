import { OpenAPIV3 } from "openapi-types"

export interface schemaHandlerOptions {
  trace: string

  schema: OpenAPIV3.SchemaObject
  parent?: OpenAPIV3.SchemaObject
}

export const walkSchema = (
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  handler: (options: schemaHandlerOptions) => void,
  trace?: string,
): void => doWalkSchema(schema, handler, trace || "/", new Set())

const doWalkSchema = (
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  handler: (options: schemaHandlerOptions) => void,
  trace: string,
  visited: Set<OpenAPIV3.SchemaObject>,
  parent?: OpenAPIV3.SchemaObject,
): void => {
  if ("$ref" in schema) {
    throw new Error(`unexpected $ref at ${trace}, schema must be dereferenced`)
  } else if (visited.has(schema)) {
    return
  }

  handler({ trace, schema, parent })

  if (schema.type === "array") {
    doWalkSchema(schema.items, handler, `${trace}/items`, visited, schema)
  }
  if (schema.properties) {
    Object.entries(schema.properties).map(([name, entry]) => [
      name,
      doWalkSchema(entry, handler, `${trace}/properties/${encodeURIComponent(name)}`, visited, schema),
    ])
  }
  if (schema.allOf) {
    schema.allOf.forEach((entry, index) => doWalkSchema(entry, handler, `${trace}/allOf/${index}`, visited, schema))
  }
  if (schema.oneOf) {
    schema.oneOf.forEach((entry, index) => doWalkSchema(entry, handler, `${trace}/oneOf/${index}`, visited, schema))
  }
  if (schema.anyOf) {
    schema.anyOf.forEach((entry, index) => doWalkSchema(entry, handler, `${trace}/anyOf/${index}`, visited, schema))
  }
}
