import { OpenAPIV3 } from "openapi-types"

import { Document, Links, SchemaDecoder } from "./Document"
import { DocumentTrace } from "./DocumentTrace"
import { Operation, OperationConfig } from "./Operation"
import { Parameter, ParameterConfig } from "./Parameter"
import { map } from "./utils"

export type PathConfig<SchemaType> = {
  parameters?: Array<ParameterConfig<SchemaType>>
  "x-sdf-links"?: Links
} & {
  [method in OpenAPIV3.HttpMethods]?: OperationConfig<SchemaType> | undefined
}

// These regular expressions are based on AWS HTTP API requirements
const paramRegex = /^\{[\w.:-]+\}$/ // The original regex allows catch-all param like {proxy+}, but we don't support that currently
const partRegex = /^[a-zA-Z0-9.:_-]+$/

export class Path<SchemaType> {
  public readonly operations: {
    [key in OpenAPIV3.HttpMethods]?: Operation<SchemaType>
  }

  public readonly parameters: Array<Parameter<SchemaType>>

  public links: Links

  public readonly patternParts: Array<{ value: string; param: boolean }>

  constructor(
    public readonly document: Document<SchemaType>,
    public readonly pattern: string,
    { parameters, "x-sdf-links": links, ...operations }: PathConfig<SchemaType>,
  ) {
    this.parameters = parameters?.map((param, index) => new Parameter(this, index, param)) || []

    this.operations = map(
      operations,
      (operation, method) => new Operation(this, method as OpenAPIV3.HttpMethods, operation),
    )

    this.links = links ?? {}

    if (!pattern.startsWith("/")) {
      throw new Error(`Path pattern must start with / at ${this.trace()}`)
    }

    const pathParams = new Set<string>()

    // LIMIT: OAS3.0 only simple path parameters are supported (https://swagger.io/specification/v3/#paths-object)
    this.patternParts = pattern.split("/").map((part, index) => {
      if (index === 0 || partRegex.test(part)) {
        return { value: part, param: false }
      } else if (paramRegex.test(part)) {
        const param = part.slice(1, -1)
        if (pathParams.has(param)) {
          throw new Error(`Duplicate path parameter '${param}' at ${this.trace()}`)
        }
        pathParams.add(param)
        return { value: param, param: true }
      } else {
        throw new Error(`Invalid path pattern part '${part}' at ${this.trace()}`)
      }
    })
  }

  decode<ST>(decoder: SchemaDecoder<ST>): PathConfig<ST> {
    return {
      ...map(this.operations, operation => operation.decode(decoder)),
      parameters: this.parameters.length ? this.parameters.map(param => param.decode(decoder)) : undefined,
      "x-sdf-links": this.links,
    }
  }

  trace(): DocumentTrace {
    return this.document.trace().append("paths", this.pattern)
  }
}
