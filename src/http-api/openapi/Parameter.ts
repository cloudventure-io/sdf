import { BaseParameter, BaseParameterConfig } from "./BaseParameter"
import { SchemaDecoder } from "./Document"
import { Operation } from "./Operation"
import { Path } from "./Path"

export const ParameterTypesArray = ["header", "query", "path", "cookie"] as const
export type ParameterTypes = (typeof ParameterTypesArray)[number]

export interface ParameterConfig<SchemaType> extends BaseParameterConfig<SchemaType> {
  name: string
  in: string
}

export type ParametersMap<SchemaType> = {
  [type in ParameterTypes]?: Record<string, Parameter<SchemaType>>
}

export class Parameter<SchemaType> extends BaseParameter<SchemaType> {
  public name: ParameterConfig<SchemaType>["name"]
  public in: ParameterConfig<SchemaType>["in"]

  constructor(
    public readonly parent: Path<SchemaType> | Operation<SchemaType>,
    public readonly index: number,
    { name, in: _in, ...rest }: ParameterConfig<SchemaType>,
  ) {
    super(parent, rest)

    if (_in !== "header" && _in !== "query" && _in !== "path" && _in !== "cookie") {
      throw new Error(`invalid parameter 'in' value '${_in}' at ${this.trace()}`)
    }

    // HTTP Headers are case-insensitive, so we normalize for that
    this.name = _in === "header" ? name.toLowerCase() : name
    this.in = _in
  }

  decode<ST>(decoder: SchemaDecoder<ST>): ParameterConfig<ST> {
    return {
      ...super.decode(decoder),
      name: this.name,
      in: this.in,
    }
  }

  decodeClean<ST>(decoder: SchemaDecoder<ST>): ParameterConfig<ST> {
    return this.decode(decoder)
  }

  trace() {
    return this.parent.trace().append("parameters", this.index)
  }
}
