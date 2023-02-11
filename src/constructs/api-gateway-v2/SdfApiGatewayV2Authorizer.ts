import { Construct } from "constructs";
import { OpenAPIV3 } from "openapi-types";
import { SdfService } from "../../SdfService";
import { SdfLambda } from "../lambda/SdfLambda";
import { pascalCase } from "change-case";

export interface SdfApiGatewayV2AuthorizerConfig {
  name: string;

  context: OpenAPIV3.SchemaObject;
}

export class SdfApiGatewayV2Authorizer extends Construct {
  constructor(
    scope: Construct,
    id: string,
    config: SdfApiGatewayV2AuthorizerConfig
  ) {
    super(scope, id);
    const service = SdfService.getServiceFromCtx(this);

    service._registerInterface({
      ...config.context,
      title: pascalCase(`AuthorizerContext${config.name}`),
    });
    // new SdfLambda(this, 'authorizer', {
    //     entryPoint:
    // })
  }
}
