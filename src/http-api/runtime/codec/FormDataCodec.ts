import { Codec } from "./Codec"

export type FormDataCodecData = {
  [key in string]?: string
}

export class FormDataCodec<Input extends FormDataCodecData> extends Codec<Input, string> {
  encode(input: Input): string {
    return new URLSearchParams(
      Object.fromEntries(Object.entries(input).filter((e): e is [string, string] => typeof e[1] === "string")),
    ).toString()
  }

  decode(output: string): Input {
    return Object.fromEntries(new URLSearchParams(output).entries()) as Input
  }
}
