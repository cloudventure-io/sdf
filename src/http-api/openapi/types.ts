import { OpenAPIV3 } from "openapi-types"

export interface ParameterObject<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.ParameterObject {
  schema?: SchemaType
}

export interface MediaTypeObject<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.MediaTypeObject {
  schema?: SchemaType
}

export interface HeaderObject<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.HeaderObject {
  schema?: SchemaType
}

export interface ResponseObject<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.ResponseObject {
  content?: {
    [media in string]: MediaTypeObject<SchemaType>
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

export interface OperationObject<
  SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject =
    | OpenAPIV3.SchemaObject
    | OpenAPIV3.ReferenceObject,
> extends OpenAPIV3.OperationObject {
  parameters?: Array<ParameterObject<SchemaType>>
  requestBody?: RequestBodyObject<SchemaType>
  responses: {
    [code: string]: ResponseObject<SchemaType>
  }
}

export interface PathItemObjectBase<
  SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject =
    | OpenAPIV3.SchemaObject
    | OpenAPIV3.ReferenceObject,
> extends OpenAPIV3.PathItemObject {
  parameters?: Array<ParameterObject<SchemaType>>
}

export type PathItemObject<
  SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject =
    | OpenAPIV3.SchemaObject
    | OpenAPIV3.ReferenceObject,
> = PathItemObjectBase<SchemaType> & {
  [method in OpenAPIV3.HttpMethods]?: OperationObject<SchemaType>
}

export type PathsObject<
  SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject =
    | OpenAPIV3.SchemaObject
    | OpenAPIV3.ReferenceObject,
> = {
  [pattern: string]: PathItemObject<SchemaType>
}

export interface ComponentsObject<SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject>
  extends OpenAPIV3.ComponentsObject {
  schemas?: {
    [key: string]: SchemaType
  }

  securitySchemes?: {
    [key: string]: SchemaType extends OpenAPIV3.ReferenceObject
      ? OpenAPIV3.ReferenceObject | OpenAPIV3.SecuritySchemeObject
      : OpenAPIV3.SecuritySchemeObject
  }
}

export interface BundledDocument<
  SchemaType extends OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject =
    | OpenAPIV3.SchemaObject
    | OpenAPIV3.ReferenceObject,
> extends OpenAPIV3.Document {
  paths: PathsObject<SchemaType>
  components?: ComponentsObject<SchemaType>

  "x-sdf-source": string
}

export type DereferencedDocument = BundledDocument<OpenAPIV3.SchemaObject>
