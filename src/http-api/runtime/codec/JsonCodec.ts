import { Codec } from "./Codec"

export class JsonCodec<Input> extends Codec<Input, string> {
  encode(input: Input): string {
    return input === undefined ? "" : JSON.stringify(input)
  }

  decode(output: string): Input {
    return output === "" ? undefined : JSON.parse(output)
  }
}
