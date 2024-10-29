import { MediaContainer, MediaContainerCodecs } from "./MediaContainerCodec"

describe("MediaCodecHttpApiServer", () => {
  const codec = MediaContainerCodecs["text/html"]
  const codec2 = MediaContainerCodecs["application/octet-stream"]

  const sampleText = "Hello, world!"
  const encoder = new TextEncoder()
  const sampleBuffer = encoder.encode(sampleText).buffer

  const encodedBuffer: MediaContainer = {
    body: Buffer.from(sampleText).toString("base64"),
    isBase64Encoded: true,
  }
  const encodedString: MediaContainer = {
    body: sampleText,
    isBase64Encoded: false,
  }

  test("encodes a buffer to base64 encoded media", () => {
    expect(codec2.encode(sampleBuffer)).toEqual(encodedBuffer)
  })

  test("encodes a string to non-base64 encoded media", () => {
    expect(codec.encode(sampleText)).toEqual(encodedString)
  })

  test("decodes base64 encoded media to a buffer", () => {
    expect(codec2.decode(encodedBuffer)).toEqual(sampleBuffer)
  })

  test("decodes non-base64 encoded media to a string", () => {
    expect(codec.decode(encodedString)).toEqual(sampleText)
  })
})
