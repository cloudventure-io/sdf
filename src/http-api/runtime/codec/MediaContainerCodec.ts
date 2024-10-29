import { Base64ArrayBufferCodec } from "./Base64ArrayBufferCodec"
import { Codec } from "./Codec"
import { FormDataCodec } from "./FormDataCodec"
import { JsonCodec } from "./JsonCodec"

export interface MediaContainer<IsBase64 extends boolean = boolean> {
  body: string
  isBase64Encoded?: IsBase64
}

class StringMediaContainerCodec extends Codec<string, MediaContainer<false>> {
  encode(input: string): MediaContainer<false> {
    return {
      body: input,
      isBase64Encoded: false,
    }
  }

  decode(output: MediaContainer<false>): string {
    return output.body
  }
}

class Base64MediaContainerCodec extends Codec<ArrayBuffer, MediaContainer<true>> {
  static Base64 = new Base64ArrayBufferCodec()

  encode(input: ArrayBuffer): MediaContainer<true> {
    return {
      body: Base64MediaContainerCodec.Base64.encode(input),
      isBase64Encoded: true,
    }
  }

  decode(output: MediaContainer<true>): ArrayBuffer {
    return Base64MediaContainerCodec.Base64.decode(output.body)
  }
}

export class MediaContainerCodec extends Codec<string | ArrayBuffer, MediaContainer> {
  static Text = new StringMediaContainerCodec()
  static Base64 = new Base64MediaContainerCodec()

  encode(input: string | ArrayBuffer): MediaContainer {
    return typeof input === "string" ? MediaContainerCodec.Text.encode(input) : MediaContainerCodec.Base64.encode(input)
  }

  decode(output: MediaContainer): string | ArrayBuffer {
    return output.isBase64Encoded === true
      ? MediaContainerCodec.Base64.decode(output as MediaContainer<true>)
      : MediaContainerCodec.Text.decode(output as MediaContainer<false>)
  }
}

export class Utf8MediaContainerCodec extends Codec<string, MediaContainer, ArrayBuffer> {
  static Codec = new MediaContainerCodec()
  static textDecoder = new TextDecoder("utf-8")

  encode(input: string | ArrayBuffer): MediaContainer {
    return Utf8MediaContainerCodec.Codec.encode(input)
  }

  decode(output: MediaContainer): string {
    const r = Utf8MediaContainerCodec.Codec.decode(output)
    return typeof r === "string" ? r : Utf8MediaContainerCodec.textDecoder.decode(r)
  }
}

export class BinaryMediaContainerCodec extends Codec<ArrayBuffer, MediaContainer, string> {
  static Codec = new MediaContainerCodec()
  static textDecoder = new TextEncoder()

  encode(input: string | ArrayBuffer): MediaContainer {
    return BinaryMediaContainerCodec.Codec.encode(input)
  }

  decode(output: MediaContainer): ArrayBuffer {
    const r = Utf8MediaContainerCodec.Codec.decode(output)
    return typeof r === "string" ? BinaryMediaContainerCodec.textDecoder.encode(r).buffer : r
  }
}

export const JsonMediaContainerCodec = Codec.chain(JsonCodec, Utf8MediaContainerCodec)
export const FormMediaContainerCodec = Codec.chain(FormDataCodec, Utf8MediaContainerCodec)

export const MediaContainerCodecs = {
  "text/plain": new Utf8MediaContainerCodec(),
  "text/html": new Utf8MediaContainerCodec(),
  "application/octet-stream": new BinaryMediaContainerCodec(),
  "application/json": new JsonMediaContainerCodec(),
  "application/x-www-form-urlencoded": new FormMediaContainerCodec(),
}
