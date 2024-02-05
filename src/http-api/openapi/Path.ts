import { OpenAPIV3 } from "openapi-types"

import { Document, Links, SchemaDecoder, SchemaRecoder } from "./Document"
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

export class Path<SchemaType> {
  public readonly operations: {
    [key in OpenAPIV3.HttpMethods]?: Operation<SchemaType>
  }

  public readonly parameters: Array<Parameter<SchemaType>>

  public links: Links

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
  }

  decode<ST>(decoder: SchemaDecoder<ST>): PathConfig<ST> {
    return {
      ...map(this.operations, operation => operation.decode(decoder)),
      parameters: this.parameters.length ? this.parameters.map(param => param.decode(decoder)) : undefined,
      "x-sdf-links": this.links,
    }
  }

  recode(recoder: SchemaRecoder): void {
    this.parameters.map(param => param.recode(recoder))
    map(this.operations, operation => operation.recode(recoder))
  }

  trace(): DocumentTrace {
    return this.document.trace().append("paths", this.pattern)
  }
}
