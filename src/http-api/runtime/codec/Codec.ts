export interface Encoder<Input, Output> {
  readonly _input?: Input

  encode(input: Input): Output
}

export interface Decoder<Input, Output> {
  readonly _output?: Output

  decode(output: Output): Input
}

export abstract class Codec<Input, Output, EncInput = never, EncOutput = never>
  implements Encoder<Input | EncInput, Output>, Decoder<Input, Output | EncOutput>
{
  readonly _input!: Input
  readonly _output!: Output

  abstract encode(input: Input | EncInput): Output
  abstract decode(output: Output | EncOutput): Input

  chain<NewOutput>(codec: Codec<Output, NewOutput>): Codec<Input, NewOutput> {
    return new CodecChain<Input, Output, NewOutput>(this, codec)
  }

  static chain<Input, Link, Output>(
    codec1: new () => Codec<Input, Link>,
    codec2: new () => Codec<Link, Output>,
  ): new () => Codec<Input, Output> {
    return class extends CodecChain<Input, Link, Output> {
      constructor() {
        super(new codec1(), new codec2())
      }
    }
  }
}

export type CodecInput<C extends Encoder<unknown, unknown>> = C["_input"]
export type CodecOutput<C extends Decoder<unknown, unknown>> = C["_output"]

export class CodecChain<
  Input,
  Link,
  Output,
  Codec1 extends Codec<Input, Link> = Codec<Input, Link>,
  Codec2 extends Codec<Link, Output> = Codec<Link, Output>,
> extends Codec<Input, Output> {
  constructor(
    public codec1: Codec1,
    public codec2: Codec2,
  ) {
    super()
  }

  encode(input: Input): Output {
    return this.codec2.encode(this.codec1.encode(input))
  }

  decode(input: Output): Input {
    return this.codec1.decode(this.codec2.decode(input))
  }
}

export class EchoCodec<T> extends Codec<T, T> {
  encode(input: T): T {
    return input
  }

  decode(output: T): T {
    return output
  }
}
