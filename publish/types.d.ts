declare module "*.openapi.yml" {
  const spec: import("./types/http-api/openapi/types").Document<object>
  export default spec
}

declare module "*.openapi.yaml" {
  const spec: import("./types/http-api/openapi/types").Document<object>
  export default spec
}

declare module "*/openapi.yml" {
  const spec: import("./types/http-api/openapi/types").Document<object>
  export default spec
}

declare module "*/openapi.yaml" {
  const spec: import("./types/http-api/openapi/types").Document<object>
  export default spec
}

declare module "*?filepath" {
  const result: string
  export default result
}
