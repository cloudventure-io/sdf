import { OpenAPIV3 } from "openapi-types";
import { MimeTypes } from "../utils/MimeTypes";

export interface ParameterObject extends OpenAPIV3.ParameterObject {
  schema: OpenAPIV3.SchemaObject;
}

export interface MediaTypeObject extends OpenAPIV3.MediaTypeObject {
  schema: OpenAPIV3.SchemaObject;
}

export interface HeaderObject extends OpenAPIV3.HeaderObject {
  schema: OpenAPIV3.SchemaObject;
}

export interface ResponseObject extends OpenAPIV3.ResponseObject {
  content: {
    [MimeTypes.APPLICATION_JSON]: MediaTypeObject;
  };
  headers?: {
    [header: string]: HeaderObject;
  };
}

export interface RequestBodyObject extends OpenAPIV3.RequestBodyObject {
  content: {
    [MimeTypes.APPLICATION_JSON]: MediaTypeObject;
  };
}

export interface SdfResources {
  [resourceName: string]: Array<string>;
}

export type OperationObject<T extends {}> = OpenAPIV3.OperationObject<T> & {
  parameters?: Array<ParameterObject>;
  operationId: string;
  requestBody?: RequestBodyObject;
  responses: {
    [code: string]: ResponseObject;
  };
  "x-sdf-resources"?: SdfResources;
};

export interface PathItemObjectBase extends OpenAPIV3.PathItemObject {
  parameters?: Array<ParameterObject>;
}

export type PathItemObject<T extends {}> = PathItemObjectBase & {
  [method in OpenAPIV3.HttpMethods]: OperationObject<T>;
};

export type PathsObject<T extends {}> = {
  [pattern: string]: PathItemObject<T>;
};

export interface AwsApiKeySecurityScheme
  extends OpenAPIV3.ApiKeySecurityScheme {
  "x-amazon-apigateway-authorizer"?: {
    type: "request";
    authorizerCredentials?: string;
    authorizerPayloadFormatVersion: "1.0" | "2.0";
    enableSimpleResponses?: boolean;
    identitySource: string;
    authorizerResultTtlInSeconds: string;
  };

  "x-sdf-response-schema"?: OpenAPIV3.SchemaObject;
}

export type SecuritySchemeObject =
  | OpenAPIV3.SecuritySchemeObject
  | AwsApiKeySecurityScheme;

export interface ComponentsObject extends OpenAPIV3.ComponentsObject {
  schemas?: {
    [key: string]: OpenAPIV3.SchemaObject;
  };
  securitySchemes?: {
    [key: string]: AwsApiKeySecurityScheme;
  };
}

export interface Document<OperationType extends {}>
  extends OpenAPIV3.Document<OperationType> {
  paths: PathsObject<OperationType>;
  components: ComponentsObject;

  "x-sdf-spec-path": string;
  "x-sdf-resources"?: SdfResources;
}
