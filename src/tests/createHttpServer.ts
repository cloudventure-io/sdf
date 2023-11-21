import http, { RequestListener } from "http"
import { AddressInfo } from "net"

export interface HttpServer {
  server: http.Server
  address: AddressInfo
  close: () => Promise<void>
}

export const createHttpServer = async (
  listener: (...args: Parameters<RequestListener>) => Promise<ReturnType<RequestListener>>,
): Promise<HttpServer> => {
  const server = http.createServer(async (req, res) => {
    try {
      await listener(req, res)
    } catch (e) {
      console.error(e)
      res.writeHead(500)
      res.end()
    }
  })

  const address: AddressInfo = await new Promise((resolve, reject) => {
    server.on("error", reject)
    server.on("listening", () => resolve(server.address() as AddressInfo))
    // listening on 0.0.0.0, to allow the http server to be accessible for keycloak container
    server.listen(undefined, "0.0.0.0")
  })

  return {
    server,
    address,
    close: async () => new Promise(resolve => server.close(() => resolve())),
  }
}
