import {
  defaultOperationTitle,
  extractOperationSchema,
  OperationObjectSchema,
} from "./extractOperationSchema";
import { Document } from "../../openapi/types";
import { join } from "path";
import { SdfLambda, SdfLambdaHandler } from "../lambda/SdfLambda";
import { SdfService } from "../../SdfService";
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

export interface SdfApiGatewayV2Config<T extends {}> {
  document: Document<T>;

  stageName?: string;

  lambdaConfig?: Omit<
    LambdaFunctionConfig,
    "handler" | "runtime" | "role" | "functionName"
  >;
}

const entryPointFunctionName = "entrypoint";

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

  private dereferencedDocument?: Document<OperationType>;

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

    // clone the document, since document will be mutated in further operations
    this.document = JSON.parse(
      JSON.stringify(this.config.document)
    ) as Document<OperationType>;

    // define lambda functions
    walkOperations({
      document: this.document,
      operationHandler: (operation: OperationHandlerOptions<OperationType>) =>
        this.defineLambda(operation),
    });

    // define the Api Gateway V2
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

  private defineLambda(operation: OperationHandlerOptions<OperationType>) {
    const { operationId } = operation.operationSpec;

    const lambda = new SdfLambda(this, `api-handler-${operationId}`, {
      timeout: 29,
      memorySize: 512,
      ...this.config.lambdaConfig,

      functionName: this.app._concatName(this.service.id, this.id, operationId),
      publish: true,
      runtime: "node16.x",
      handler: async (): Promise<SdfLambdaHandler> =>
        this.renderLambdaHandler(operation),
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

  private async renderLambdaHandler(
    rawOperation: OperationHandlerOptions<OperationType>
  ): Promise<SdfLambdaHandler> {
    const operation = await this.dereferenceOperation(rawOperation);

    const schema = extractOperationSchema(operation);
    this.service._registerSchema(schema);

    const entryPointPath = await this.renderLambdaFiles(
      operation,
      schema
    );

    const entryPointRelPath = relative(this.service.absDir, entryPointPath);

    return {
      handler: `${entryPointRelPath}.${entryPointFunctionName}`,
      entryPoint: `${entryPointRelPath}.ts`,
    };
  }

  private async dereferenceOperation(
    rawOperation: OperationHandlerOptions<OperationType>
  ): Promise<OperationHandlerOptions<OperationType>> {
    const document = await this.initialize();
    const pathSpec = document?.paths?.[rawOperation.pathPattern];
    if (!pathSpec) {
      throw new Error(`cannot find the dereferenced path`);
    }
    const operationSpec = pathSpec?.[rawOperation.method];
    if (!operationSpec) {
      throw new Error(`cannot find the dereferenced operation`);
    }
    return {
      ...rawOperation,
      document,
      pathSpec,
      operationSpec,
    };
  }

  private async initialize(): Promise<Document<OperationType>> {
    if (!this.dereferencedDocument) {
      // clean up before generating
      await rm(this.entryPointsDirectory, { force: true, recursive: true });
      await mkdir(this.entryPointsDirectory, { recursive: true });

      // clone and dereference the document
      this.dereferencedDocument = (await SwaggerParser.dereference(
        JSON.parse(JSON.stringify(this.document))
      )) as Document<OperationType>;
    }
    return this.dereferencedDocument;
  }

  private async renderValidator(
    operation: OperationHandlerOptions<OperationType>,
    schema: OperationObjectSchema
  ): Promise<string> {
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
        OperationModel: schema.title,
      },
      overwrite: true,
    });

    return validatorPath;
  }

  private async renderLambdaFiles(
    operation: OperationHandlerOptions<OperationType>,
    schema: OperationObjectSchema
  ): Promise<string> {
    const operationId = operation.operationSpec.operationId;

    const validatorPath = await this.renderValidator(operation, schema);

    const handlerPath = join(this.handlersDirectory, operationId);
    const entryPointPath = join(
      this.entryPointsDirectory,
      camelCase(`api-${operationId}`)
    );

    await writeMustacheTemplate({
      template: entryPointTemplate,
      path: `${entryPointPath}.ts`,
      overwrite: true,
      context: {
        OperationModel: schema.title,
        InterfacesImport: relative(
          this.entryPointsDirectory,
          this.service._interfacesAbsPath
        ),
        HandlerImport: relative(this.entryPointsDirectory, handlerPath),
        ValidatorsImport: relative(this.entryPointsDirectory, validatorPath),
        EntryPointFunctionName: entryPointFunctionName,
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

    return entryPointPath;
  }

  // const authorizerResponseSchemas: {
  //   [name in string]: OpenAPIV3.SchemaObject;
  // } = {};
  // if (this.document.components.securitySchemes) {
  //   Object.entries(this.document.components.securitySchemes).forEach(
  //     ([name, securitySchema]) => {
  //       if (
  //         securitySchema.type === "apiKey" &&
  //         typeof securitySchema["x-amazon-apigateway-authorizer"] ===
  //           "object" &&
  //         securitySchema["x-amazon-apigateway-authorizer"].type ===
  //           "request" &&
  //         typeof securitySchema["x-sdf-response-schema"] === "object"
  //       ) {
  //         authorizerResponseSchemas[`Authorizer${securitySchema.name}`] = {
  //           title: `Authorizer${securitySchema.name}`,
  //           ...securitySchema["x-sdf-response-schema"],
  //         };
  //       }
  //     }
  //   );
  // }
}
