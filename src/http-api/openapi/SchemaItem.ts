import { OpenAPIV3 } from "openapi-types"

export interface SchemaItemJsonSchema {
  type: "json-schema"
  value: OpenAPIV3.SchemaObject
}

export type SchemaItem = SchemaItemJsonSchema
