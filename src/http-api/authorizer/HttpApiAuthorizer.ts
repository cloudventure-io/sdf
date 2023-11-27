import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { HttpApi } from "../HttpApi"

export abstract class HttpApiAuthorizer extends Construct {
  /** The spec method should return the OpenAPI spec for the authorizer */
  public abstract spec(api: HttpApi): Record<string, any>

  /** Authorization context schema */
  public abstract get contextSchema(): OpenAPIV3.SchemaObject
}
