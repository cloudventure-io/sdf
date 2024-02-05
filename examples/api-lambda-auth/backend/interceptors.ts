import { RequestInterceptor } from "@cloudventure/sdf/http-api/runtime"

export const requestInterceptor: RequestInterceptor = async (event, operation) => {
  console.log(operation.resolveSecurity())
  return event
}
