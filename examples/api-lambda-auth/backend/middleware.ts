import { Middleware } from "@cloudventure/sdf/http-api/runtime/server/Middleware"

const middleware: Middleware = {
  async request(request) {
    console.log("Request:", JSON.stringify(request.event))
    return request
  },

  async response(response) {
    console.log("Response:", JSON.stringify(response))
    return response
  },
}

export default middleware
