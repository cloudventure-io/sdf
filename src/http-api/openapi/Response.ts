import { MimeTypes } from "../common/MimeTypes"
import { BaseParameter, BaseParameterConfig } from "./BaseParameter"
import { Document, SchemaDecoder } from "./Document"
import { MediaType, MediaTypeConfig } from "./MediaType"
import { Operation } from "./Operation"
import { Parameter } from "./Parameter"
import { map } from "./utils"

export interface ResponseConfig<SchemaType> {
  description: string

  headers?: {
    [header: string]: BaseParameterConfig<SchemaType>
  }

  content?: {
    [media: string]: MediaTypeConfig<SchemaType>
  }
}

export class Response<SchemaType> {
  public description: ResponseConfig<SchemaType>["description"]

  public headers?: Record<string, Parameter<SchemaType>>

  public content?: {
    [media: string]: MediaType<SchemaType>
  }

  public readonly document: Document<SchemaType>

  constructor(
    public operation: Operation<SchemaType>,
    public statusCode: number,
    { description, headers, content }: ResponseConfig<SchemaType>,
  ) {
    this.document = operation.document

    this.description = description
    this.headers = map(headers, header => new BaseParameter(this, header))
    this.content = map(content, (mediaTypeConfig, mediaType) => new MediaType(this, mediaType, mediaTypeConfig))
  }

  decode<ST>(decoder: SchemaDecoder<ST>): ResponseConfig<ST> {
    return {
      description: this.description,
      headers: map(this.headers, header => header.decode(decoder)),
      content: map(this.content, mediaType => mediaType.decode(decoder)),
    }
  }

  defaultMediaType(): MediaType<SchemaType> | undefined {
    if (!this.content) {
      return
    }

    const mediaTypeOrder = [
      MimeTypes.ApplicationJson,
      MimeTypes.ApplicationFormURLEncoded,
      MimeTypes.ApplicationOctetStream,
    ]

    for (const mediaType of mediaTypeOrder) {
      if (mediaType in this.content) {
        return this.content[mediaType]
      }
    }

    return Object.values(this.content).sort()[0]
  }
}
