import { SchemaDecoder } from "./Document"
import { RequestBody } from "./RequestBody"
import { Response } from "./Response"
import { SchemaItem } from "./SchemaItem"

export interface MediaTypeConfig<SchemaType> {
  schema?: SchemaType
}

export class MediaType<SchemaType> {
  schema?: SchemaItem
  mediaType: string

  constructor(
    parent: RequestBody<SchemaType> | Response<SchemaType>,
    mediaType: string,
    { schema }: MediaTypeConfig<SchemaType>,
  ) {
    this.schema = schema && parent.document.encoder(schema)
    this.mediaType = mediaType
  }

  decode<ST>(decoder: SchemaDecoder<ST>): MediaTypeConfig<ST> {
    return {
      schema: this.schema && decoder(this.schema),
    }
  }
}
