import { BaseParameter, BaseParameterConfig } from "./BaseParameter"
import { Document, SchemaDecoder, SchemaRecoder } from "./Document"
import { Operation } from "./Operation"
import { Parameter } from "./Parameter"
import { SchemaItem } from "./SchemaItem"
import { map } from "./utils"

export interface ResponseConfig<SchemaType> {
  description: string

  headers?: {
    [header: string]: BaseParameterConfig<SchemaType>
  }

  content?: {
    [media: string]: {
      schema?: SchemaType
    }
  }
}

export class Response<SchemaType> {
  public description: ResponseConfig<SchemaType>["description"]

  public headers?: Record<string, Parameter<SchemaType>>

  public content?: {
    [media: string]: {
      schema?: SchemaItem
    }
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
    this.content = map(content, ({ schema }) => ({ schema: schema && this.document.encoder(schema) }))
  }

  decode<ST>(decoder: SchemaDecoder<ST>): ResponseConfig<ST> {
    return {
      description: this.description,
      headers: map(this.headers, header => header.decode(decoder)),
      content: map(this.content, ({ schema }) => ({ schema: schema && decoder(schema) })),
    }
  }

  recode(recoder: SchemaRecoder): void {
    map(this.headers, header => header.recode(recoder))
    map(this.content, ({ schema }) => ({ schema: schema && recoder(schema) }))
  }
}
