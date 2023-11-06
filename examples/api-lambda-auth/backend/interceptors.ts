import { httpApiRuntime } from "@cloudventure/sdf"

export const requestInterceptor: httpApiRuntime.RequestInterceptor = async (event, operation) => {
  console.log(operation.operationSpec.security)
  return event
}
