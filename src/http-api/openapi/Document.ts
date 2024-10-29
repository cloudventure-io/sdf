import { OpenAPIV3 } from "openapi-types"

import { DocumentTrace } from "./DocumentTrace"
import { Operation } from "./Operation"
import { Path, PathConfig } from "./Path"
import { SchemaItem } from "./SchemaItem"
import { map } from "./utils"

export type Links = {
  [name: string]: Array<string>
}

export type SecurityRequirementsConfig = Array<Record<string, Array<string>>>

export interface DocumentConfig<SchemaType = OpenAPIV3.SchemaObject> {
  openapi: string

  info: {
    title: string
    version: string
  }

  paths: {
    [pattern in string]?: PathConfig<SchemaType>
  }

  components?: {
    schemas?: Record<string, SchemaType>
    securitySchemes?: Record<string, OpenAPIV3.SecuritySchemeObject>
  }

  security?: SecurityRequirementsConfig

  "x-sdf-source"?: string
  "x-sdf-links"?: Links

  encoder?: SchemaEncoder<SchemaType>
}

export type SchemaEncoder<SchemaType> = (input: SchemaType) => SchemaItem
export type SchemaDecoder<SchemaType> = (input: SchemaItem) => SchemaType

export class Document<SchemaType = OpenAPIV3.SchemaObject> {
  readonly openapi: string
  readonly source?: string

  info: DocumentConfig<SchemaType>["info"]

  paths: {
    [pattern in string]: Path<SchemaType>
  }

  links?: Links

  security?: SecurityRequirementsConfig
  securitySchemes?: Record<string, OpenAPIV3.SecuritySchemeObject>
  schemas?: Record<string, SchemaItem>

  readonly encoder: SchemaEncoder<SchemaType>

  /**
   * Map of operations.
   *
   * Operations are registered by Operation class.
   */
  readonly operations: Record<string, Operation<SchemaType>> = {}

  constructor({
    openapi,
    paths,
    info,
    security,
    "x-sdf-links": links,
    "x-sdf-source": source,
    components,
    encoder = input => ({ type: "json-schema", value: input as OpenAPIV3.SchemaObject }),
  }: DocumentConfig<SchemaType>) {
    this.encoder = encoder

    this.openapi = openapi
    this.source = source
    this.info = info
    this.links = links
    this.security = security
    this.securitySchemes = components?.securitySchemes
    this.schemas = components?.schemas && map(components.schemas, schema => encoder(schema))

    this.paths = map(paths, (path, pattern) => new Path(this, pattern, path))
  }

  decode<ST>(decoder: SchemaDecoder<ST>): DocumentConfig<ST> {
    return {
      openapi: this.openapi,

      "x-sdf-links": this.links,
      "x-sdf-source": this.source,

      info: this.info,
      paths: map(this.paths, path => path.decode(decoder)),

      security: this.security,

      components: {
        schemas: map(this.schemas, schema => decoder(schema)),
        securitySchemes: this.securitySchemes,
      },
    }
  }

  trace(): DocumentTrace {
    return new DocumentTrace(this.source || "anonymous")
  }
}
