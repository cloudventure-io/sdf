import { OpenAPIV3 } from "openapi-types"

import { MimeTypes } from "../../utils/MimeTypes"

export interface ParameterObject<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.ParameterObject {
  schema: SchemaType
}

export interface MediaTypeObject<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.MediaTypeObject {
  schema?: SchemaType
}

export interface HeaderObject<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.HeaderObject {
  schema: SchemaType
}

export interface ResponseObject<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.ResponseObject {
  content?: {
    [MimeTypes.APPLICATION_JSON]: MediaTypeObject<SchemaType>
  }
  headers?: {
    [header: string]: HeaderObject<SchemaType>
  }
}

export interface RequestBodyObject<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.RequestBodyObject {
  content: {
    [media: string]: MediaTypeObject<SchemaType>
  }
}

export interface SdfResources {
  [resourceName: string]: Array<string>
}

export type OperationObject<
  OperationType extends object,
  SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
> = OpenAPIV3.OperationObject<OperationType> & {
  parameters?: Array<ParameterObject<SchemaType>>
  requestBody?: RequestBodyObject<SchemaType>
  responses: {
    [code: string]: ResponseObject<SchemaType>
  }
  "x-sdf-resources"?: SdfResources

  /**
   * List of HTTP status codes that considered successful.
   * If not specified all status codes smaller than 400 will
   * be considered successful.
   **/
  "x-sdf-success-codes"?: Array<number>
}

export interface PathItemObjectBase<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.PathItemObject {
  parameters?: Array<ParameterObject<SchemaType>>
}

export type PathItemObject<
  OperationType extends object,
  SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
> = PathItemObjectBase<SchemaType> & {
  [method in OpenAPIV3.HttpMethods]?: OperationObject<OperationType, SchemaType>
}

export type PathsObject<
  OperationType extends object,
  SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
> = {
  [pattern: string]: PathItemObject<OperationType, SchemaType>
}

export interface ComponentsObject<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.ComponentsObject {
  schemas?: {
    [key: string]: SchemaType
  }
}

export interface Document<
  OperationType extends object,
  SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject =
    | OpenAPIV3.SchemaObject
    | OpenAPIV3.ReferenceObject,
> extends OpenAPIV3.Document<OperationType> {
  paths: PathsObject<OperationType, SchemaType>
  components?: ComponentsObject<SchemaType>

  "x-sdf-spec-path": string
  "x-sdf-resources"?: SdfResources
}

export type DereferencedDocument<OperationType extends object> = Document<OperationType, OpenAPIV3.SchemaObject>
