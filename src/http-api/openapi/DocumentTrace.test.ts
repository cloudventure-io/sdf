import { DocumentTrace } from "./DocumentTrace"

describe("openapi", () => {
  it("traceStr tests", () => {
    expect(new DocumentTrace("file/path.yml").toString()).toBe("file/path.yml")

    expect(new DocumentTrace("file/path.yml", ["test"]).toString()).toBe("file/path.yml/#test")
    expect(new DocumentTrace("file/path.yml", ["test"]).append("test2").toString()).toBe("file/path.yml/#test/test2")
    expect(new DocumentTrace("file/path.yml", ["test"]).append(["test2"]).toString()).toBe("file/path.yml/#test/test2")
    expect(new DocumentTrace("file/path.yml", ["test/aaa"]).append("test2").toString()).toBe(
      "file/path.yml/#test%2Faaa/test2",
    )

    expect(`${new DocumentTrace("file/path.yml", ["test"])}`).toBe("file/path.yml/#test")
  })
})
