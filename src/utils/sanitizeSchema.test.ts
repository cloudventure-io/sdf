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

  it("should return a copy of the input schema if no allOf is present", () => {
    const inputSchema: OpenAPIV3.SchemaObject = {
      type: "string",
    }
    const result = sanitizeSchema(inputSchema)
    expect(result).toEqual(inputSchema)
    expect(result).not.toBe(inputSchema) // Ensure a copy is returned
  })

  it("should merge allOf schemas if they are all type object", () => {
    const inputSchema: OpenAPIV3.SchemaObject = {
      title: "Root",
      allOf: [
        { type: "object", properties: { a: { type: "string" } } },
        { type: "object", properties: { b: { type: "number" } } },
      ],
    }
    const expectedSchema: OpenAPIV3.SchemaObject = {
      title: "Root",
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
    }
    const result = sanitizeSchema(inputSchema)
    expect(result).toEqual(expectedSchema)
  })

  it("should handle nested allOfs", () => {
    const inputSchema: OpenAPIV3.SchemaObject = {
      title: "Root",
      allOf: [
        {
          title: "Nested",
          allOf: [
            { type: "object", properties: { a: { type: "string" } } },
            { type: "object", properties: { b: { type: "number" } } },
          ],
        },
        { type: "object", properties: { c: { type: "boolean" } } },
      ],
    }
    const expectedSchema: OpenAPIV3.SchemaObject = {
      title: "Root",
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
        c: { type: "boolean" },
      },
    }
    const result = sanitizeSchema(inputSchema)
    expect(result).toEqual(expectedSchema)
  })

  it("should handle additionalProperties", () => {
    const inputSchema: OpenAPIV3.SchemaObject = {
      title: "Root",
      allOf: [
        { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
        { type: "object", properties: { b: { type: "number" } } },
      ],
    }
    const expectedSchema: OpenAPIV3.SchemaObject = {
      title: "Root",
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
      additionalProperties: false,
    }
    const result = sanitizeSchema(inputSchema)
    expect(result).toEqual(expectedSchema)
  })

  it("should compile required fields from allOf", () => {
    const inputSchema: OpenAPIV3.SchemaObject = {
      title: "Root",
      allOf: [
        { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        { type: "object", properties: { b: { type: "number" } }, required: ["b"] },
      ],
    }
    const expectedSchema: OpenAPIV3.SchemaObject = {
      title: "Root",
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
      required: ["a", "b"],
    }
    const result = sanitizeSchema(inputSchema)
    expect(result).toEqual(expectedSchema)
  })
})
