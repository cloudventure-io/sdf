import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { KmsKey, KmsKeyConfig } from "@cdktf/provider-aws/lib/kms-key"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { SdfResource } from "../SdfResource"

export class SdfResourceKmsKey extends SdfResource {
  public key: KmsKey

  get configSpec(): OpenAPIV3.SchemaObject {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        arn: {
          type: "string",
        },
        keyId: {
          type: "string",
        },
      },
      required: ["arn", "keyId"],
    }
  }

  public permissions: {
    encrypt: DataAwsIamPolicyDocument
    decrypt: DataAwsIamPolicyDocument
  }

  public config: {
    arn: string
    keyId: string
  }

  constructor(scope: Construct, public id: string, key: KmsKey | KmsKeyConfig) {
    super(scope, id)

    this.key = key instanceof KmsKey ? key : new KmsKey(this, id, key)

    this.permissions = {
      encrypt: new DataAwsIamPolicyDocument(this, "encrypt", {
        statement: [
          {
            actions: ["kms:Encrypt"],
            resources: [this.key.arn],
          },
        ],
      }),
      decrypt: new DataAwsIamPolicyDocument(this, "decrypt", {
        statement: [
          {
            actions: ["kms:Decrypt"],
            resources: [this.key.arn],
          },
        ],
      }),
    }

    this.config = {
      arn: this.key.arn,
      keyId: this.key.keyId,
    }
  }
}
