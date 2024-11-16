import { Document, SchemaDecoder } from "./Document"
import { MediaType, MediaTypeConfig } from "./MediaType"
import { Operation } from "./Operation"
import { map } from "./utils"

export interface RequestBodyConfig<SchemaType> {
  description?: string
  required?: boolean

  content: {
    [media: string]: MediaTypeConfig<SchemaType>
  }
}

export class RequestBody<SchemaType> {
  public description: RequestBodyConfig<SchemaType>["description"]
  public required: RequestBodyConfig<SchemaType>["required"]

  public readonly document: Document<SchemaType>

  content: {
    [media: string]: MediaType<SchemaType>
  }

  constructor(operation: Operation<SchemaType>, { description, required, content }: RequestBodyConfig<SchemaType>) {
    this.document = operation.document

    this.description = description
    this.required = required
    this.content = map(content, (mediaTypeConfig, mediaType) => new MediaType(this, mediaType, mediaTypeConfig))
  }

  decode<ST>(decoder: SchemaDecoder<ST>): RequestBodyConfig<ST> {
    return {
      description: this.description,
      required: this.required,
      content: map(this.content, mediaType => mediaType.decode(decoder)),
    }
  }

  decodeClean<ST>(decoder: SchemaDecoder<ST>): RequestBodyConfig<ST> {
    return this.decode(decoder)
  }
}
