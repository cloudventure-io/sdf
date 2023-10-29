import axios from "axios"

import { OperationTestingResponses } from "./backend/interfaces"

describe("end-to-end tests", () => {
  if (!process.env.SDF_TEST_API_URL) {
    throw new Error("SDF_TEST_API_URL env var is not set")
  }

  const client = axios.create({
    baseURL: process.env.SDF_TEST_API_URL,
  })

  it("basic", async () => {
    const res = await client.get("/testing", { headers: { Authorization: "token" } })

    expect(res.status).toBe(200)

    const body: OperationTestingResponses["body"] = res.data

    expect(body.ok).toBe(true)
    expect(body.user).toBe("token")
  })

  it("authorizer failed", async () => {
    const res = await client.get("/testing", { headers: { Authorization: "t" }, validateStatus: () => true })

    expect(res.status).toBe(500)
  })
})
