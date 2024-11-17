import { pascalCase } from "change-case"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { HttpApiAuthorizer } from "./HttpApiAuthorizer"

export interface HttpApiJwtAuthorizerConfig {
  /**
   * The name of the authorizer.
   */
  name: string

  /**
   * A comma-separated list of mapping expressions of the request parameters as the identity source.
   * Defaults to '$request.header.Authorization'.
   * */
  identitySource?: string

  /**
   * The number of seconds during which authorizer result is cached.
   * Defaults to 300.
   * */
  authorizerResultTtlInSeconds?: number

  /** The issuer URL of the JWT token. */
  issuer: string

  /** A list of the intended recipients of the JWT. */
  audience: Array<string>

  /** Authorization context JWT schema */
  claims?: OpenAPIV3.SchemaObject
}

export class HttpApiJwtAuthorizer extends HttpApiAuthorizer {
  private claimsSchema: OpenAPIV3.SchemaObject
  public contextSchema: OpenAPIV3.SchemaObject

  constructor(
    scope: Construct,
    id: string,
    private config: HttpApiJwtAuthorizerConfig,
  ) {
    super(scope, id)

    this.claimsSchema = config.claims ?? {
      type: "object",
      properties: {
        aud: { type: "string" },
        sub: { type: "string" },
        iss: { type: "string" },
      },
      required: ["aud", "sub", "iss"],
    }

    this.contextSchema = {
      title: pascalCase(`AuthorizerContext-${this.config.name}`),
      type: "object",
      properties: {
        jwt: {
          type: "object",
          properties: {
            claims: this.claimsSchema,
          },
          required: ["claims"],
        },
      },
      required: ["jwt"],
    }
  }

  public init(): void {}

  public spec(): Record<string, any> {
    return {
      type: "jwt",
      identitySource: this.config.identitySource ?? "$request.header.Authorization",
      authorizerResultTtlInSeconds: this.config.authorizerResultTtlInSeconds ?? 300,
      jwtConfiguration: {
        audience: this.config.audience,
        issuer: this.config.issuer,
      },
    }
  }
}
