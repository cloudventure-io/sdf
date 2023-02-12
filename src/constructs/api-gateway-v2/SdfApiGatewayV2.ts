import {
  defaultOperationTitle,
  ExtracedOperation,
  extractOperations,
  OperationObjectSchema,
} from "./extractOperations";
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

  /**
   * the entry points directory of the api,
   * `services/{serviceName}/api/entrypoints`.
   */
  private entryPointsDirectory: string;

  /**
   * the validators directory of the api,
   * `services/{serviceName}/api/entrypoints/validators`
   */
  private validatorsDirectory: string;

  /**
   * the handlers directory of the api,
   * `services/{serviceName}/api/handlers`
   */
  private handlersDirectory: string;

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

    const apiDirectory = join(this.service.absDir, this.id);
    this.entryPointsDirectory = join(apiDirectory, "entrypoints");
    this.validatorsDirectory = join(this.entryPointsDirectory, "validators");
    this.handlersDirectory = join(apiDirectory, "handlers");

    // clone the document
    this.document = JSON.parse(
      JSON.stringify(this.config.document)
    ) as Document<OperationType>;

    // submit interfaces
    this.service._registerInterfaces(() => this.registerInterfaces());

    // define lambda functions
    walkOperations({
      document: this.document,
      operationHandler: (operation: OperationHandlerOptions<OperationType>) =>
        this.defineLambda(operation),
    });

    const api = (this.apigw = new Apigatewayv2Api(this, "api", {
      name: this.app._concatName(this.service.id, this.id),
      protocolType: "HTTP",
      body: JSON.stringify(this.document),
    }));

    // add lambda permissions
    walkOperations({
      document: this.document,
      operationHandler: (operation: OperationHandlerOptions<OperationType>) => {
        const { operationId } = operation.operationSpec;

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

  private getHandlerPath = (operationId: string): string =>
    join(this.handlersDirectory, operationId);

  private getEntryPointPath = (operationId: string): string =>
    join(this.entryPointsDirectory, camelCase(`api-${operationId}`));

  private async renderValidator({
    schema,
    operation,
  }: ExtracedOperation<OperationType>): Promise<string> {
    const {
      operationSpec: { operationId },
    } = operation;

    const ajv = new Ajv({
      code: { source: true, esm: true },
      strict: false,
      allErrors: true,
    });

    const moduleCode = standaloneCode(
      ajv,
      ajv.compile(schema.properties.request)
    );

    await mkdir(this.validatorsDirectory, { recursive: true });

    const validatorPath = join(
      this.validatorsDirectory,
      `${operationId}.validator`
    );

    await writeFile(`${validatorPath}.js`, moduleCode);

    await writeMustacheTemplate({
      template: validatorTemplate,
      path: `${validatorPath}.d.ts`,
      context: {
        OperationModel: defaultOperationTitle(operation, "operation"),
      },
      overwrite: true,
    });

    return validatorPath;
  }

  private async renderFiles({
    schema,
    operation,
  }: ExtracedOperation<OperationType>): Promise<void> {
    const {
      operationSpec: { operationId },
    } = operation;

    const validatorPath = await this.renderValidator({
      schema,
      operation: operation,
    });

    const handlerPath = this.getHandlerPath(operationId);
    const entryPointPath = this.getEntryPointPath(operationId);

    await writeMustacheTemplate({
      template: entryPointTemplate,
      path: `${entryPointPath}.ts`,
      overwrite: true,
      context: {
        OperationModel: defaultOperationTitle(operation, "operation"),
        InterfacesImport: relative(
          this.entryPointsDirectory,
          this.service._interfacesAbsPath
        ),
        HandlerImport: relative(this.entryPointsDirectory, handlerPath),
        ValidatorsImport: relative(this.entryPointsDirectory, validatorPath),
      },
    });

    await writeMustacheTemplate({
      template: handlerTemplate,
      path: `${handlerPath}.ts`,
      overwrite: false,
      context: {
        WrapperImport: relative(this.handlersDirectory, entryPointPath),
      },
    });
  }

  private async registerInterfaces(): Promise<SdfServiceRenderInterfacesResult> {
    // clean up before generating
    await rm(this.entryPointsDirectory, { force: true, recursive: true });
    await mkdir(this.entryPointsDirectory, { recursive: true });

    // clone and dereference the spec
    const spec = (await SwaggerParser.dereference(
      JSON.parse(JSON.stringify(this.document))
    )) as Document<OperationType>;

    const operations = extractOperations({
      document: spec,
      operationSchemaTitle: defaultOperationTitle,
    });

    // generate files for all operations
    await Promise.all(
      Object.values(operations).map(async (operation) =>
        this.renderFiles(operation)
      )
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

  private defineLambda(operation: OperationHandlerOptions<OperationType>) {
    const { operationId } = operation.operationSpec;

    const entryPointRelPath = relative(
      this.service.absDir,
      this.getEntryPointPath(operationId)
    );

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
        ...operation.operationSpec["x-sdf-resources"],
      },
    });

    this.lambdas[operationId] = lambda;

    // add api gateway integration into spec
    operation.operationSpec["x-amazon-apigateway-integration"] = {
      payloadFormatVersion: "2.0",
      type: "aws_proxy",
      httpMethod: "POST",
      uri: lambda.function.qualifiedInvokeArn,
      connectionType: "INTERNET",
    };
  }
}
