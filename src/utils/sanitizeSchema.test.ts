import { OpenAPIV3 } from "openapi-types"

import { sanitizeSchema } from "./sanitizeSchema"

describe("sanitize schema", () => {
  it("sanitize schema basic", () => {
    const schema: OpenAPIV3.SchemaObject = {
      title: "Root",
      allOf: [
        {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["age"],
        },
        {
          type: "object",
          properties: {
            email: { type: "string" },
          },
          required: ["name", "email"],
        },
      ],
    }

    const res = sanitizeSchema(schema)
    expect(res).toStrictEqual({
      title: "Root",
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        email: { type: "string" },
      },
      required: ["age", "name", "email"],
    } satisfies OpenAPIV3.SchemaObject)
  })

  it("sanitize schema nested", () => {
    const schema: OpenAPIV3.SchemaObject = {
      title: "Root",
      allOf: [
        {
          title: "Child",
          allOf: [
            {
              type: "object",
              properties: {
                name: { type: "string" },
                age: { type: "number" },
              },
              required: ["age"],
            },
            {
              type: "object",
              properties: {
                email: { type: "string" },
              },
              required: ["name", "email"],
            },
          ],
        },
      ],
    }

    const res = sanitizeSchema(schema)

    expect(res).toStrictEqual({
      title: "Root",
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        email: { type: "string" },
      },
      required: ["age", "name", "email"],
    } satisfies OpenAPIV3.SchemaObject)
  })

  it("sanitize schema basic", () => {
    const schema: OpenAPIV3.SchemaObject = {
      title: "Root",
      allOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["age"],
        },
        {
          additionalProperties: {
            type: "string",
          },
          type: "object",
          properties: {
            email: { type: "string" },
          },
          required: ["name", "email"],
        },
      ],
    }

    const res = sanitizeSchema(schema)
    expect(res).toStrictEqual({
      title: "Root",
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        email: { type: "string" },
      },
      required: ["age", "name", "email"],
      additionalProperties: false,
    } satisfies OpenAPIV3.SchemaObject)
  })

  it("sanitize schema complex", () => {
    const schema: OpenAPIV3.SchemaObject = {
      title: "Root",
      allOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            age: { type: "number" },
          },
          required: ["age"],
        },
        {
          oneOf: [
            {
              type: "object",
            },
          ],
        },
        {
          additionalProperties: {
            type: "string",
          },
          type: "object",
          properties: {
            email: { type: "string" },
          },
          required: ["name", "email"],
        },
      ],
    }

    const res = sanitizeSchema(schema)
    expect(res).toStrictEqual(schema)
  })
})
