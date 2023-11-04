import axios from "axios"

import { OperationIdentityMeResponses } from "./backend/.gen/interfaces"

describe("end-to-end tests", () => {
  if (!process.env.SDF_TEST_API_URL) {
    throw new Error("SDF_TEST_API_URL env var is not set")
  }

  const client = axios.create({
    baseURL: process.env.SDF_TEST_API_URL,
  })

  it("basic", async () => {
    const res = await client.get("/identity", { headers: { Authorization: "token" } })

    expect(res.status).toBe(200)

    const body: OperationIdentityMeResponses["body"] = res.data

    expect(body.ok).toBe(true)
    expect(body.user).toBe("token")
  })

  it("authorizer failed", async () => {
    const res = await client.get("/identity", { headers: { Authorization: "t" }, validateStatus: () => true })

    expect(res.status).toBe(500)
  })
})
