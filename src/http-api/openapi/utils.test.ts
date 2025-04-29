import { BundledDocument } from "./types"
import { dereference } from "./utils"

describe("openapi utils", () => {
  it("dereference nested $refs", () => {
    const d = {
      an: "object",
    }
    const res = dereference({
      a: {
        $ref: "#/b/d",
      },
      b: {
        $ref: "#/c",
      },
      c: {
        d,
      },
    } as unknown as BundledDocument)

    expect(res["a"]).toStrictEqual(d)
  })
})
