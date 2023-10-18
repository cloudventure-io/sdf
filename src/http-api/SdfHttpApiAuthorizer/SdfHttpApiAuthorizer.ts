import { Construct } from "constructs"
import { SdfHttpApi } from "../SdfHttpApi/SdfHttpApi"
import { OpenAPIV3 } from "openapi-types"

export abstract class SdfHttpApiAuthorizer extends Construct {
  /** The spec method should return the OpenAPI spec for the authorizer */
  public abstract spec(api: SdfHttpApi): Record<string, any>

  /** Authorization context schema */
  public abstract context(): OpenAPIV3.SchemaObject
}