import { pascalCase } from "change-case"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { SdfService } from "../../SdfService"

export interface SdfApiGatewayV2AuthorizerConfig {
  name: string

  context: OpenAPIV3.SchemaObject
}

export class SdfApiGatewayV2Authorizer extends Construct {
  constructor(scope: Construct, id: string, config: SdfApiGatewayV2AuthorizerConfig) {
    super(scope, id)
    const service = SdfService.getServiceFromCtx(this)

    service._registerSchema({
      ...config.context,
      title: pascalCase(`AuthorizerContext${config.name}`),
    })
    // new SdfLambda(this, 'authorizer', {
    //     entryPoint:
    // })
  }
}
