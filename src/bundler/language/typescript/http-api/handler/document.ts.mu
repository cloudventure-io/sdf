import { Document } from "@cloudventure/sdf/http-api/openapi/Document"
import { BundledDocument } from "@cloudventure/sdf/http-api/openapi/types"
import { dereference } from "@cloudventure/sdf/http-api/openapi/utils"

import documentJson from "./openapi.json";

export const document = new Document(dereference(documentJson as BundledDocument))
