import { constantCase } from "change-case"
import lodash from "lodash"
import { OpenAPIV3 } from "openapi-types"

interface SchemaHandlerOptions {
  trace: string

  schema: OpenAPIV3.SchemaObject
  parent?: OpenAPIV3.SchemaObject

  /**
   * If stop function is called, the walkSchema function will stop walking the current schema.
   *
   * This is useful, when replacing part of the schema during the walk and the walk on the replaced part is not necessary.
   */
  stop: () => void
}

export class SchemaRegistry {
  public schemas: { [key in string]: OpenAPIV3.SchemaObject } = {}

  /**
   * Register new JSON Schema in schema registry.
   *
   * Dereferences the provided schema using the schema registry, so that schemas with the same title
   * always point to the same object.
   *
   * The top level schema must have a `title` attribute.
   *
   * Returns a new copy of the schema with the dereferenced references from schema registry.
   *
   * @param input the schema to register, must be dereferenced
   * @param trace the trace of the schema
   * @returns the dereferenced schema
   */
  public register(input: OpenAPIV3.SchemaObject, trace?: string): OpenAPIV3.SchemaObject {
    const [mergedSchema, schemasCut] = this.sanitizeSchema(input, trace)

    // dereference the input schema using already registered schemas based on titles
    const res = this.addSchema(mergedSchema, trace)

    schemasCut.forEach(s => this.register(s, trace))

    return res
  }

  private addSchema(input: OpenAPIV3.SchemaObject, trace?: string): OpenAPIV3.SchemaObject {
    return this.walkSchema(
      input,
      ({ schema, stop }) => {
        const title = schema.title

        if (!title) {
          return
        }

        if (title in this.schemas) {
          if (lodash.isEqualWith(schema, this.schemas[title])) {
            stop()
            return this.schemas[title]
          } else {
            console.error("new:", schema)
            console.error("existing:", this.schemas[title])
            throw new Error(`schema with title '${title}' is already registered, but with different structure`)
          }
        }

        this.schemas[title] = schema
      },
      { trace },
    )
  }

  private mergeAllOfs(schema: OpenAPIV3.SchemaObject, schemasCut: Set<OpenAPIV3.SchemaObject>): OpenAPIV3.SchemaObject {
    const allOf = schema.allOf as Array<OpenAPIV3.SchemaObject>
    const title = schema.title

    if (title && allOf && allOf.length > 0) {
      // create groups of SchemaObjects where either every element in the group has type "object",
      // or the group contains only a single element.
      const allOfGroups = allOf
        .reduce(
          ([head, ...rest], s) =>
            !head.length || (head[0].type === "object" && s.type === "object")
              ? [[...head, s], ...rest] // append to the head
              : [[s], head, ...rest], // create new group
          [[]] as Array<Array<OpenAPIV3.SchemaObject>>,
        )
        .reverse()

      // unpack allOfGroups and merge groups
      const newAllOffs = allOfGroups.map(allOfGroup => {
        if (allOfGroup.length === 1) {
          return allOfGroup[0]
        }

        const res: OpenAPIV3.SchemaObject = {
          type: "object",
          properties: allOfGroup
            .filter(s => !!s.properties)
            .map(s => s.properties)
            .reduce((acc, p) => ({ ...acc, ...p }), {}),
          required: allOfGroup
            .filter(s => s.required)
            .map(s => s.required as string[])
            .flat(1)
            .reduce<Array<string>>((acc, p) => (acc.includes(p) ? acc : [...acc, p]), []),
        }

        // if some of the merged schemas are not referenced anyhere else, we will lose them.
        // but the user might want to have the generated interfaces for those schemas, so we want
        // to track them.
        allOfGroup.forEach(s => schemasCut.add(s))

        const additionalProperties = allOfGroup.find(s => s?.additionalProperties !== undefined)

        if (additionalProperties) {
          res.additionalProperties = additionalProperties.additionalProperties
        }

        return res
      })

      // collapse if there is only one group and it is an object
      if (newAllOffs.length === 1 && newAllOffs[0].type === "object") {
        schema.type = "object"
        schema.properties = newAllOffs[0].properties
        schema.required = newAllOffs[0].required
        if (schema.additionalProperties === undefined && newAllOffs[0].additionalProperties !== undefined) {
          schema.additionalProperties = newAllOffs[0].additionalProperties
        }
        delete schema.allOf
        if (schema.required?.length === 0) {
          delete schema.required
        }
      } else {
        schema.allOf = newAllOffs
      }
    }

    return schema
  }

  private sanitizeSchema = <T extends OpenAPIV3.SchemaObject>(
    input: T,
    trace?: string,
  ): [T, Set<OpenAPIV3.SchemaObject>] => {
    const copy: T = lodash.cloneDeep(input) as T
    const schemasCut = new Set<OpenAPIV3.SchemaObject>()

    this.walkSchema(copy, ({ schema }) => this.mergeAllOfs(schema, schemasCut), { depthFirst: true, trace })

    this.transformSchema(copy, trace)

    return [copy, schemasCut]
  }

  private transformSchema = <T extends OpenAPIV3.SchemaObject>(input: T, trace?: string): T => {
    return this.walkSchema(
      input,
      ({ schema }) => {
        // Use Buffer type for binary format
        // if (schema.type === "string" && schema.format === "binary") {
        //   schema["tsType"] = "Buffer"
        //   schema["format"] = "base64"
        // }

        // Add tsEnumNames to all enums if x-ts-enum is set. This will indicate to
        // json-schema-to-typescript library to generate the type as enum.
        if (
          "enum" in schema &&
          schema.enum &&
          Array.isArray(schema.enum) &&
          schema["x-ts-enum"] &&
          !schema["tsEnumNames"]
        ) {
          ;(schema as any).tsEnumNames = schema.enum.map(e => constantCase(e))
        }
      },
      { trace },
    ) as T
  }

  private walkSchema(
    schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
    handler: (options: SchemaHandlerOptions) => OpenAPIV3.SchemaObject | void,
    {
      trace,
      depthFirst,
    }: {
      trace?: string
      depthFirst?: boolean
    } = {},
  ): OpenAPIV3.SchemaObject {
    return this._walkSchema(schema, handler, trace || "/", new Set(), undefined, depthFirst)
  }

  private _walkSchema = (
    schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
    handler: (options: SchemaHandlerOptions) => OpenAPIV3.SchemaObject | void,
    trace: string,
    visited: Set<OpenAPIV3.SchemaObject>,
    parent?: OpenAPIV3.SchemaObject,
    depthFirst?: boolean,
  ): OpenAPIV3.SchemaObject => {
    if ("$ref" in schema) {
      throw new Error(`unexpected $ref at ${trace}, schema must be dereferenced`)
    } else if (visited.has(schema)) {
      return schema
    }

    let s: OpenAPIV3.SchemaObject | undefined | void
    let stop = false

    if (!depthFirst) {
      s = handler({
        trace,
        schema,
        parent,
        stop: () => {
          stop = true
        },
      })
    }
    s ??= schema

    if (stop) {
      return s
    }

    if (s.type === "array" && s.items) {
      s.items = this._walkSchema(s.items, handler, `${trace}/items`, visited, s, depthFirst)
    }

    if (s.properties) {
      for (const key in s.properties) {
        s.properties[key] = this._walkSchema(
          s.properties[key],
          handler,
          `${trace}/properties/${encodeURIComponent(key)}`,
          visited,
          s,
          depthFirst,
        )
      }
    }

    if (s.allOf) {
      for (const key in s.allOf) {
        s.allOf[key] = this._walkSchema(s.allOf[key], handler, `${trace}/allOf/${key}`, visited, s, depthFirst)
      }
    }
    if (s.oneOf) {
      for (const key in s.oneOf) {
        s.oneOf[key] = this._walkSchema(s.oneOf[key], handler, `${trace}/oneOf/${key}`, visited, s, depthFirst)
      }
    }
    if (s.anyOf) {
      for (const key in s.anyOf) {
        s.anyOf[key] = this._walkSchema(s.anyOf[key], handler, `${trace}/anyOf/${key}`, visited, s, depthFirst)
      }
    }

    if (depthFirst) {
      s =
        handler({
          trace,
          schema,
          parent,
          stop: () => {
            /* noop */
          },
        }) ?? schema
    }

    return s
  }
}
