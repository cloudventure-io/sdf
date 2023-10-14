import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { SdfApp } from "../SdfApp"
import { SdfResource } from "../SdfResource"
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
  public sdfStack: SdfStack
  public sdfApp: SdfApp

  constructor(scope: Construct, id: string) {
    super(scope, id)

    this.node.setContext(SdfBundler.name, this)
    this.node.setContext(this.constructor.name, this)
    this.sdfStack = SdfStack.getStackFromCtx(this)
    this.sdfApp = SdfApp.getAppFromContext(this)
  }

  public schemas: { [key in string]: OpenAPIV3.SchemaObject } = {}
  _registerSchema(schema: OpenAPIV3.SchemaObject) {
    if (!schema.title) {
      throw new Error(`schema does not have a title`)
    }

    if (!this.schemas[schema.title]) {
      this.schemas[schema.title] = schema
    } else if (this.schemas[schema.title] !== schema) {
      throw new Error(`a schema with the same title '${schema.title}' is already registered`)
    }
  }

  public resources: { [id in string]: SdfResource } = {}
  public registerResource(resource: SdfResource, id: string) {
    if (this.resources[id] && this.resources[id] !== resource) {
      throw new Error(`resource with id '${id}' already exists in the bundler '${this.node.id}'`)
    }
    this.resources[id] = resource
  }

  public getResource(id: string) {
    const resource = this.resources[id]
    if (!resource) {
      throw new Error(`resource with id '${id}' was not found in the bundler '${this.node.id}'`)
    }
    return resource
  }

  public abstract getBundleManifest(): SdfBundleManifest

  public abstract lambdaConfig(lambda: SdfLambda<SdfBundler>): Partial<LambdaFunctionConfig>

  public _context_type?: unknown
}
