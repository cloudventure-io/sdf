import { Encoder } from "./Codec"

export class HeaderEncoder<VT extends string | number | boolean | undefined = string | number | boolean | undefined>
  implements Encoder<Record<string, VT> | Headers, Record<string, string>>
{
  encode(input: Record<string, VT> | Headers): Record<string, string> {
    return Object.fromEntries(
      Object.entries(input)
        .filter((e): e is [string, Exclude<VT, undefined>] => e[1] !== undefined)
        .map(([key, value]) => [key.toLowerCase(), String(value)]),
    )
  }
}
