import { Codec } from "./Codec"

export class Base64Codec extends Codec<Buffer, string> {
  encode(input: Buffer): string {
    return input.toString("base64")
  }

  decode(output: string): Buffer {
    return Buffer.from(output, "base64")
  }
}
