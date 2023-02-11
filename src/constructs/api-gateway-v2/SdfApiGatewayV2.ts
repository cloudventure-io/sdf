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
    const entryPointsDirectory = join(apiDirectory, "entrypoints");
    const validatorsDirectory = join(entryPointsDirectory, "validators");
    const handlersDirectory = join(apiDirectory, "handlers");

    // clone the document
    const document: Document<OperationType> = JSON.parse(
      JSON.stringify(this.config.document)
    );

    // submit interfaces
    const interfacesPath = this.service._registerInterfaces(
      async (): Promise<SdfServiceRenderInterfacesResult> => {
        // await rm(entryPointsDirectory, { force: true, recursive: true });
        // await mkdir(entryPointsDirectory);

        const spec = (await SwaggerParser.dereference(
          JSON.parse(JSON.stringify(document))
        )) as Document<OperationType>;

        const operations = extractOperations({
          document: spec,
          operationSchemaTitle: defaultOperationTitle,
        });

        await Promise.all(
          Object.entries(operations).map(async ([operationName, operation]) => {
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

            await mkdir(validatorsDirectory, { recursive: true });

            await writeFile(
              join(validatorsDirectory, `${operationId}.validator.js`),
              moduleCode
            );

            writeMustacheTemplate({
              template: validatorTemplate,
              path: join(validatorsDirectory, `${operationId}.validator.d.ts`),
              context: {
                OperationModel: defaultOperationTitle(options, "operation"),
              },
              overwrite: true,
            });
          })
        );

        const authorizerResponseSchemas: { [name in string]: OpenAPIV3.SchemaObject } =
          {};
        if (document.components.securitySchemes) {
          Object.entries(document.components.securitySchemes).forEach(
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
                }
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
    );

    // operations entrypoints and handlers generation
    walkOperations({
      document,
      operationHandler: (options: OperationHandlerOptions<OperationType>) => {
        const { operationId } = options.operationSpec;
        const handlerPath = join(handlersDirectory, operationId);

        const entryPointAbsPath = join(
          entryPointsDirectory,
          camelCase(`api-${operationId}`)
        );
        const entryPointRelPath = relative(
          this.service.absDir,
          entryPointAbsPath
        );

        const requestContentType = Object.keys(
          options.operationSpec?.requestBody?.content || {}
        )[0];

        writeMustacheTemplate({
          template: entryPointTemplate,
          path: `${entryPointAbsPath}.ts`,
          overwrite: true,
          context: {
            OperationModel: defaultOperationTitle(options, "operation"),
            InterfacesImport: relative(entryPointsDirectory, interfacesPath),
            HandlerImport: relative(entryPointsDirectory, handlerPath),
            RequestContentType: requestContentType
              ? JSON.stringify(requestContentType)
              : "undefined",
            ValidatorsImport: relative(
              entryPointsDirectory,
              join(validatorsDirectory, `${operationId}.validator`)
            ),
          },
        });

        writeMustacheTemplate({
          template: handlerTemplate,
          path: `${handlerPath}.ts`,
          overwrite: false,
          context: {
            WrapperImport: relative(handlersDirectory, entryPointAbsPath),
          },
        });

        const lambda = new SdfLambda(this, `api-handler-${operationId}`, {
          timeout: 29,
          memorySize: 512,
          ...config.lambdaConfig,

          entryPoint: `${entryPointRelPath}.ts`,
          functionName: this.app._concatName(
            this.service.name,
            this.id,
            operationId
          ),
          publish: true,
          runtime: "node16.x",
          handler: `${entryPointRelPath}.entrypoint`,
          resources: {
            ...document["x-sdf-resources"],
            ...options.operationSpec["x-sdf-resources"],
          },
        });

        this.lambdas[operationId] = lambda;

        options.operationSpec["x-amazon-apigateway-integration"] = {
          payloadFormatVersion: "2.0",
          type: "aws_proxy",
          httpMethod: "POST",
          uri: lambda.function.qualifiedInvokeArn,
          connectionType: "INTERNET",
        };
      },
    });

    // if (document.components?.securitySchemes) {
    //   Object.entries(document.components?.securitySchemes)
    // }

    const api = (this.apigw = new Apigatewayv2Api(this, "api", {
      name: this.app._concatName(this.service.name, this.id),
      protocolType: "HTTP",
      body: JSON.stringify(document),
    }));

    // add lambda permissions
    walkOperations({
      document,
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
      name: config.stageName || this.service.name,
      autoDeploy: true,
    });

    return this;
  }
}
