import { LambdaFunctionConfig } from "@cdktf/provider-aws/lib/lambda-function"
import { Construct } from "constructs"
import _ from "lodash"
import { OpenAPIV3 } from "openapi-types"

import { SdfApp } from "../SdfApp"
import { SdfStack } from "../SdfStack"
import { SdfLambda } from "../constructs"
import { sanitizeSchema } from "../utils/sanitizeSchema"
import { walkSchema } from "../utils/walkSchema"

export interface SdfBundleManifest {
  /** The id of the bundle */
  id: string

  /** The type of the bundle */
  type: "typescript" | "docker"
}

export abstract class SdfBundler extends Construct {
  public stack: SdfStack
  public app: SdfApp

  constructor(scope: Construct, id: string) {
    super(scope, id)

    this.node.setContext(SdfBundler.name, this)
    this.node.setContext(this.constructor.name, this)
    this.stack = SdfStack.getStackFromCtx(this)
    this.app = SdfApp.getAppFromContext(this)
  }

  public schemas: { [key in string]: OpenAPIV3.SchemaObject } = {}

  /**
   * registerSchema method registers a new JSON Schema into the schema registry of the bundler.
   *
   * It merges allOfs using `json-schema-merge-allof` library, so that `json-schema-to-typescript`
   * library can generate correct interfaces with object composition. The input schema will be cloned
   * and possibly mutated. This method returns the new schema object.
   *
   * It dereferences the provided schema using the schema registry, so that schemas with same title
   * always point to the same object.
   *
   * The top level schema must have a `title` for registration.
   */
  public registerSchema(schema: OpenAPIV3.SchemaObject): OpenAPIV3.SchemaObject {
    if (!schema.title) {
      throw new Error(`the top level schema must have a title`)
    }

    const mergedSchema = sanitizeSchema(schema)

    // dereference the input schema using already registered schemas based on titles
    return walkSchema(mergedSchema, ({ schema }) => {
      const title = schema.title
      if (!title) {
        return
      }
      if (title in this.schemas) {
        if (_.isEqualWith(schema, this.schemas[title])) {
          return this.schemas[title]
        } else {
          throw new Error(`schema with title '${title}' was already registered with different structure`)
        }
      } else {
        this.schemas[title] = schema
      }
    })
  }

  public abstract getBundleManifest(): SdfBundleManifest

  public abstract lambdaConfig(lambda: SdfLambda<SdfBundler>): Partial<LambdaFunctionConfig>

  public _context_type?: unknown
}
