import { Document, SchemaDecoder, SchemaRecoder } from "./Document"
import { SchemaItem } from "./SchemaItem"

export interface BaseParameterConfig<SchemaType> {
  description?: string
  schema?: SchemaType
  required?: boolean
}

export class BaseParameter<SchemaType> {
  public description: BaseParameterConfig<SchemaType>["description"]
  public required: BaseParameterConfig<SchemaType>["required"]

  public schema?: SchemaItem

  public readonly document: Document<SchemaType>

  constructor(
    parent: { document: Document<SchemaType> },
    { description, schema, required }: BaseParameterConfig<SchemaType>,
  ) {
    this.document = parent.document

    this.description = description
    this.schema = schema && this.document.encoder(schema)
    this.required = required
  }

  decode<ST>(decoder: SchemaDecoder<ST>): BaseParameterConfig<ST> {
    return {
      description: this.description,
      schema: this.schema && decoder(this.schema),
      required: this.required,
    }
  }

  recode(recoder: SchemaRecoder): void {
    this.schema = this.schema && recoder(this.schema)
  }
}
