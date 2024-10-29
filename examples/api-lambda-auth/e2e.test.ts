// import { ApiResponse } from "@cloudventure/sdf/http-api/runtime"
import { ApiResponse } from "@cloudventure/sdf/http-api/runtime/common/ApiResponse"

import { ApiClient } from "./backend/client/ApiClient"

describe("end-to-end tests", () => {
  if (!process.env.SDF_TEST_API_URL) {
    throw new Error("SDF_TEST_API_URL env var is not set")
  }
  const baseUrl = process.env.SDF_TEST_API_URL

  const client = new ApiClient(baseUrl, "test user")

  it("identify me", async () => {
    const res = await client.identityMe({})
    expect(res.statusCode).toBe(200)

    const body = res.body
    expect(body.ok).toBe(true)
    expect(body.user).toBe("test user")
  })

  it("create item", async () => {
    const res = await client.itemCreate({ body: { item: { name: "test name" } } })
    expect(res.statusCode).toBe(201)
    expect(res["body"]).toBeNull()
  })

  it("get item", async () => {
    const res = await client.itemGet({ path: { itemId: "123" } })
    expect(res.statusCode).toBe(200)
    expect(res.body.item.id).toBe("123")
    expect(res.body.item.name).toBe("test")
  })

  it("authorizer failed", async () => {
    const client = new ApiClient(baseUrl, "")
    let e: unknown = null
    try {
      await client.identityMe()
    } catch (ex) {
      e = ex
    }
    expect(e).toBeInstanceOf(ApiResponse)
    if (e instanceof ApiResponse) {
      expect(e.statusCode).toBe(403)
    }
  })
})
