import { OpenAPIV3 } from "openapi-types";

export interface schemaHandlerOptions {
  trace: string;

  schema: OpenAPIV3.SchemaObject;
  parent?: OpenAPIV3.SchemaObject;
}

export const walkSchema = (
  trace: string,
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  handler: (options: schemaHandlerOptions) => void,
  parent?: OpenAPIV3.SchemaObject
): void => {
  if ("$ref" in schema) {
    throw new Error(`unexpected $ref in ${trace}, schema must be dereferenced`);
  }

  handler({ trace, schema, parent });

  if (schema.type === "array") {
    walkSchema(`${trace}/items`, schema.items, handler, schema);
  }
  if (schema.properties) {
    Object.entries(schema.properties).map(([name, entry]) => [
      name,
      walkSchema(`${trace}/properties/${name}`, entry, handler, schema),
    ]);
  }
  if (schema.allOf) {
    schema.allOf.forEach((entry, index) =>
      walkSchema(`${trace}/allOf/${index}`, entry, handler, schema)
    );
  }
  if (schema.oneOf) {
    schema.oneOf.forEach((entry, index) =>
      walkSchema(`${trace}/oneOf/${index}`, entry, handler, schema)
    );
  }
  if (schema.anyOf) {
    schema.anyOf.forEach((entry, index) =>
      walkSchema(`${trace}/anyOf/${index}`, entry, handler, schema)
    );
  }
};
