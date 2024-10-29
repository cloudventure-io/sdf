import { FormDataCodec } from "./FormDataCodec"

describe("FormDataCodec", () => {
  const codec = new FormDataCodec()
  const sampleForm = { key: "value" }
  const formEncoded = "key=value"

  test("encodes form data to a string", () => {
    expect(codec.encode(sampleForm)).toEqual(formEncoded)
  })

  test("decodes a string to form data", () => {
    expect(codec.decode(formEncoded)).toEqual(sampleForm)
  })
})
