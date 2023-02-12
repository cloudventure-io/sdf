import { defaultOperationTitle, extractOperations } from "./extractOperations";
import { Document } from "../../openapi/types";
import { join } from "path";
import { SdfLambda } from "../lambda/SdfLambda";
import { SdfService, SdfServiceRenderInterfacesResult } from "../../SdfService";
import { relative } from "path";
import entryPointTemplate from "./templates/entryPoint.ts.mu";
import handlerTemplate from "./templates/handler.ts.mu";
import validatorTemplate from "./templates/validator.d.ts.mu";
import { writeMustacheTemplate } from "../../utils/writeMustacheTemplate";
import {
  OperationHandlerOptions,
  walkOperations,
} from "../../openapi/walkOperations";
import { Construct } from "constructs";
import { Apigatewayv2Api } from "@cdktf/provider-aws/lib/apigatewayv2-api";
import { SdfApp } from "../../SdfApp";
import SwaggerParser from "@apidevtools/swagger-parser";

import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone";
import { writeFile, mkdir, rm } from "fs/promises";
import { LambdaFunctionConfig } from "@cdktf/provider-aws/lib/lambda-function";
import { Apigatewayv2Stage } from "@cdktf/provider-aws/lib/apigatewayv2-stage";
import { LambdaPermission } from "@cdktf/provider-aws/lib/lambda-permission";
import { camelCase, pascalCase } from "change-case";
import { OpenAPIV3 } from "openapi-types";

export interface SdfApiGatewayV2Config<T extends {}> {
  document: Document<T>;

  stageName?: string;

  lambdaConfig?: Omit<
    LambdaFunctionConfig,
    "handler" | "runtime" | "role" | "functionName"
  >;
}

export class SdfApiGatewayV2<OperationType extends {} = {}> extends Construct {
  private lambdas: { [operationId in string]: SdfLambda } = {};
  private service: SdfService;
  private app: SdfApp;

  private document: Document<OperationType>;

  private apiDirectory: string;
  private entryPointsDirectory: string;
  private validatorsDirectory: string;
  private handlersDirectory: string;

  private interfacesPath: string;

  public apigw: Apigatewayv2Api;
  public stage: Apigatewayv2Stage;

  constructor(
    scope: Construct,
    private id: string,
    private config: SdfApiGatewayV2Config<OperationType>
  ) {
    super(scope, id);
    this.service = SdfService.getServiceFromCtx(this);
    this.app = SdfApp.getAppFromContext(this);

    this.apiDirectory = join(this.service.absDir, this.id);
    this.entryPointsDirectory = join(this.apiDirectory, "entrypoints");
    this.validatorsDirectory = join(this.entryPointsDirectory, "validators");
    this.handlersDirectory = join(this.apiDirectory, "handlers");

    // clone the document
    this.document = JSON.parse(
      JSON.stringify(this.config.document)
    ) as Document<OperationType>;

    // submit interfaces
    this.interfacesPath = this.service._registerInterfaces(() =>
      this.registerInterfaces()
    );

    // generate operations entrypoints and handlers
    walkOperations({
      document: this.document,
      operationHandler: (options: OperationHandlerOptions<OperationType>) =>
        this.generateEntryPointsAndHandlers(options),
    });

    // if (document.components?.securitySchemes) {
    //   Object.entries(document.components?.securitySchemes)
    // }

    const api = (this.apigw = new Apigatewayv2Api(this, "api", {
      name: this.app._concatName(this.service.id, this.id),
      protocolType: "HTTP",
      body: JSON.stringify(this.document),
    }));

    // add lambda permissions
    walkOperations({
      document: this.document,
      operationHandler: (options: OperationHandlerOptions<OperationType>) => {
        const { operationId } = options.operationSpec;

        new LambdaPermission(this, `${operationId}-apigw-lambda-permission`, {
          statementId: "AllowApiGateway",
          action: "lambda:InvokeFunction",
          functionName: this.lambdas[operationId].function.functionName,
          principal: "apigateway.amazonaws.com",
          // TODO: point to the exact path
          sourceArn: `${api.executionArn}/*/*/*`,
        });
      },
    });

    this.stage = new Apigatewayv2Stage(this, "deployment", {
      apiId: api.id,
      name: config.stageName || this.service.id,
      autoDeploy: true,
    });

    return this;
  }

  private async registerInterfaces(): Promise<SdfServiceRenderInterfacesResult> {
    // await rm(this.entryPointsDirectory, { force: true, recursive: true });
    // await mkdir(this.entryPointsDirectory);

    // clone and dereference the spec
    const spec = (await SwaggerParser.dereference(
      JSON.parse(JSON.stringify(this.document))
    )) as Document<OperationType>;

    const operations = extractOperations({
      document: spec,
      operationSchemaTitle: defaultOperationTitle,
    });

    await Promise.all(
      Object.entries(operations).map(async ([, operation]) => {
        const { options, schema: operationSchema } = operation;
        const {
          operationSpec: { operationId },
        } = options;

        const ajv = new Ajv({
          code: { source: true, esm: true },
          strict: false,
          allErrors: true,
        });

        const moduleCode = standaloneCode(
          ajv,
          ajv.compile(operationSchema.properties.request)
        );

        await mkdir(this.validatorsDirectory, { recursive: true });

        await writeFile(
          join(this.validatorsDirectory, `${operationId}.validator.js`),
          moduleCode
        );

        writeMustacheTemplate({
          template: validatorTemplate,
          path: join(this.validatorsDirectory, `${operationId}.validator.d.ts`),
          context: {
            OperationModel: defaultOperationTitle(options, "operation"),
          },
          overwrite: true,
        });
      })
    );

    const authorizerResponseSchemas: {
      [name in string]: OpenAPIV3.SchemaObject;
    } = {};
    if (this.document.components.securitySchemes) {
      Object.entries(this.document.components.securitySchemes).forEach(
        ([name, securitySchema]) => {
          if (
            securitySchema.type === "apiKey" &&
            typeof securitySchema["x-amazon-apigateway-authorizer"] ===
              "object" &&
            securitySchema["x-amazon-apigateway-authorizer"].type ===
              "request" &&
            typeof securitySchema["x-sdf-response-schema"] === "object"
          ) {
            authorizerResponseSchemas[`Authorizer${securitySchema.name}`] = {
              title: `Authorizer${securitySchema.name}`,
              ...securitySchema["x-sdf-response-schema"],
            };
          }
        }
      );
    }

    return {
      schemas: {
        // TODO: make sure that there are no duplicate keys
        ...spec.components?.schemas,
        ...authorizerResponseSchemas,
        ...Object.entries(operations).reduce(
          (acc, [key, { schema }]) => ({ ...acc, [key]: schema }),
          {}
        ),
      },
    };
  }

  private generateEntryPointsAndHandlers(
    options: OperationHandlerOptions<OperationType>
  ) {
    const { operationId } = options.operationSpec;
    const handlerPath = join(this.handlersDirectory, operationId);

    const entryPointAbsPath = join(
      this.entryPointsDirectory,
      camelCase(`api-${operationId}`)
    );
    const entryPointRelPath = relative(this.service.absDir, entryPointAbsPath);

    writeMustacheTemplate({
      template: entryPointTemplate,
      path: `${entryPointAbsPath}.ts`,
      overwrite: true,
      context: {
        OperationModel: defaultOperationTitle(options, "operation"),
        InterfacesImport: relative(
          this.entryPointsDirectory,
          this.interfacesPath
        ),
        HandlerImport: relative(this.entryPointsDirectory, handlerPath),
        ValidatorsImport: relative(
          this.entryPointsDirectory,
          join(this.validatorsDirectory, `${operationId}.validator`)
        ),
      },
    });

    writeMustacheTemplate({
      template: handlerTemplate,
      path: `${handlerPath}.ts`,
      overwrite: false,
      context: {
        WrapperImport: relative(this.handlersDirectory, entryPointAbsPath),
      },
    });

    const lambda = new SdfLambda(this, `api-handler-${operationId}`, {
      timeout: 29,
      memorySize: 512,
      ...this.config.lambdaConfig,

      entryPoint: `${entryPointRelPath}.ts`,
      functionName: this.app._concatName(this.service.id, this.id, operationId),
      publish: true,
      runtime: "node16.x",
      handler: `${entryPointRelPath}.entrypoint`,
      resources: {
        ...this.document["x-sdf-resources"],
        ...options.operationSpec["x-sdf-resources"],
      },
    });

    this.lambdas[operationId] = lambda;

    // add api gateway integration into spec
    options.operationSpec["x-amazon-apigateway-integration"] = {
      payloadFormatVersion: "2.0",
      type: "aws_proxy",
      httpMethod: "POST",
      uri: lambda.function.qualifiedInvokeArn,
      connectionType: "INTERNET",
    };
  }
}
