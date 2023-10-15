import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { SdfApp } from "../SdfApp"
import { SdfStack } from "../SdfStack"
import { LambdaFunctionConfig } from "@cdktf/provider-aws/lib/lambda-function"
import { SdfLambda } from "../constructs"

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
  public registerSchema(schema: OpenAPIV3.SchemaObject) {
    if (!schema.title) {
      throw new Error(`schema does not have a title`)
    }

    if (!this.schemas[schema.title]) {
      this.schemas[schema.title] = schema
    } else if (this.schemas[schema.title] !== schema) {
      throw new Error(`a schema with the same title '${schema.title}' is already registered`)
    }
  }

  public abstract getBundleManifest(): SdfBundleManifest

  public abstract lambdaConfig(lambda: SdfLambda<SdfBundler>): Partial<LambdaFunctionConfig>

  public _context_type?: unknown
}
