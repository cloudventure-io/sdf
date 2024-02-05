import { Document, SchemaDecoder, SchemaRecoder } from "./Document"
import { Operation } from "./Operation"
import { SchemaItem } from "./SchemaItem"
import { map } from "./utils"

export interface RequestBodyConfig<SchemaType> {
  description?: string
  required?: boolean

  content: {
    [media: string]: {
      schema?: SchemaType
    }
  }
}

export class RequestBody<SchemaType> {
  public description: RequestBodyConfig<SchemaType>["description"]
  public required: RequestBodyConfig<SchemaType>["required"]

  public readonly document: Document<SchemaType>

  content: {
    [media: string]: {
      schema?: SchemaItem
    }
  }

  constructor(operation: Operation<SchemaType>, { description, required, content }: RequestBodyConfig<SchemaType>) {
    this.document = operation.document

    this.description = description
    this.required = required
    this.content = map(content, ({ schema }) => ({ schema: schema && this.document.encoder(schema) }))
  }

  decode<ST>(decoder: SchemaDecoder<ST>): RequestBodyConfig<ST> {
    return {
      description: this.description,
      required: this.required,
      content: map(this.content, ({ schema }) => ({ schema: schema && decoder(schema) })),
    }
  }

  recode(recoder: SchemaRecoder): void {
    map(this.content, ({ schema }) => ({ schema: schema && recoder(schema) }))
  }
}
