import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { DataAwsSecretsmanagerSecret } from "@cdktf/provider-aws/lib/data-aws-secretsmanager-secret"
import { SecretsmanagerSecret, SecretsmanagerSecretConfig } from "@cdktf/provider-aws/lib/secretsmanager-secret"
import {
  SecretsmanagerSecretVersion,
  SecretsmanagerSecretVersionConfig,
} from "@cdktf/provider-aws/lib/secretsmanager-secret-version"
import { Construct } from "constructs"
import { OpenAPIV3 } from "openapi-types"

import { Resource } from "../core"

export class ResourceSecret extends Resource {
  public secret: SecretsmanagerSecret | DataAwsSecretsmanagerSecret
  public secretVersion?: SecretsmanagerSecretVersion

  get configSpec(): OpenAPIV3.SchemaObject {
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        arn: {
          type: "string",
        },
        name: {
          type: "string",
        },
      },
      required: ["arn", "name"],
    }
  }

  public permissions: {
    read: DataAwsIamPolicyDocument
    write: DataAwsIamPolicyDocument
  }

  public config: {
    arn: string
    name: string
  }

  constructor(
    scope: Construct,
    public id: string,
    secret: SecretsmanagerSecret | (SecretsmanagerSecretConfig & { exists?: boolean }),
    version?: Omit<SecretsmanagerSecretVersionConfig, "secretId">,
  ) {
    super(scope, id)

    if (secret instanceof SecretsmanagerSecret) {
      this.secret = secret

      if (version) {
        this.secretVersion = new SecretsmanagerSecretVersion(this, `${id}-version`, {
          ...version,
          secretId: this.secret.id,
        })
      }
    } else if (secret.exists) {
      this.secret = new DataAwsSecretsmanagerSecret(this, id, {
        name: secret.name,
      })
    } else {
      this.secret = new SecretsmanagerSecret(this, id, secret)
    }

    this.permissions = {
      read: new DataAwsIamPolicyDocument(this, "read", {
        statement: [
          {
            actions: ["secretsmanager:GetSecretValue"],
            resources: [this.secret.arn],
          },
        ],
      }),
      write: new DataAwsIamPolicyDocument(this, "write", {
        statement: [
          {
            actions: ["secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue"],
            resources: [this.secret.arn],
          },
        ],
      }),
    }

    this.config = {
      arn: this.secret.arn,
      name: this.secret.name,
    }
  }
}
