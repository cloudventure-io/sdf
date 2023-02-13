import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch-log-group"
import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { IamRole } from "@cdktf/provider-aws/lib/iam-role"
import { IamRolePolicy } from "@cdktf/provider-aws/lib/iam-role-policy"
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment"
import { LambdaFunction, LambdaFunctionConfig } from "@cdktf/provider-aws/lib/lambda-function"
import { TerraformResource, Token } from "cdktf"
import { constantCase } from "change-case"
import { Construct } from "constructs"

import { SdfApp } from "../../SdfApp"
import { SdfService } from "../../SdfService"

export interface SdfLambdaHandler {
  /** The name of the function */
  handler: string

  /** The file path of the entry point */
  entryPoint: string
}

type SdfLambdaFunctionConfig = Omit<LambdaFunctionConfig, "role" | "handler"> & {
  handler: SdfLambdaHandler | (() => Promise<SdfLambdaHandler>)
}
// Pick<Required<LambdaFunctionConfig>, "handler">;

export interface SdfLambdaConfig extends SdfLambdaFunctionConfig {
  resources?: { [name in string]: Array<string> }
}

export class SdfLambda extends Construct {
  private service: SdfService
  private app: SdfApp
  public function: LambdaFunction

  private handlerPromise: Promise<SdfLambdaHandler>
  public handler?: SdfLambdaHandler
  public config: Omit<SdfLambdaConfig, "handler">

  public constructor(scope: Construct, id: string, { handler, ...config }: SdfLambdaConfig) {
    super(scope, id)
    this.service = SdfService.getServiceFromCtx(this)
    this.app = SdfApp.getAppFromContext(this)
    this.config = config

    const assumeRolePolicy = new DataAwsIamPolicyDocument(this, "assume-role-policy", {
      statement: [
        {
          actions: ["sts:AssumeRole"],
          principals: [
            {
              type: "Service",
              identifiers: ["lambda.amazonaws.com"],
            },
          ],
        },
      ],
    })

    const role = new IamRole(this, "role", {
      name: this.app._concatName(config.functionName, "lambda"),
      assumeRolePolicy: assumeRolePolicy.json,
    })

    const dependsOn: Array<TerraformResource> = []

    dependsOn.push(
      new IamRolePolicyAttachment(this, "basic-execution-role-policy", {
        role: role.name,
        policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
      }),
    )

    if (config.vpcConfig) {
      dependsOn.push(
        new IamRolePolicyAttachment(this, "eni-management-role-policy", {
          role: role.name,
          policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaENIManagementAccess",
        }),
      )
    }

    const policies: Array<string> = []
    const environment: { [name: string]: string } = {
      NODE_OPTIONS: "--enable-source-maps",
    }
    if (config.resources) {
      Object.entries(config.resources).forEach(([resourceName, permissions]) => {
        const resource = this.service._getResource(resourceName)
        permissions.forEach(permissionName => {
          const permission = resource.permissions[permissionName]
          if (!permission) {
            throw new Error(
              `permission '${permissionName}' is not defined for resource '${resourceName}' in the stack '${this.service.id}'`,
            )
          }
          policies.push(permission.json)
        })

        const key = constantCase(`RESOURCE_${resourceName}`)
        environment[key] = JSON.stringify(resource.config)
      })
    }

    if (policies.length) {
      const policy = new DataAwsIamPolicyDocument(this, "policy", {
        sourcePolicyDocuments: policies,
      })
      new IamRolePolicy(this, "polocy", {
        role: role.name,
        policy: policy.json,
      })
    }

    const code = this.service.code

    new CloudwatchLogGroup(this, "logs", {
      name: `/aws/lambda/${config.functionName}`,
      retentionInDays: 30,
    })

    this.handlerPromise = Promise.resolve(typeof handler === "function" ? handler() : handler)

    this.function = new LambdaFunction(this, "lambda", {
      dependsOn,

      ...config,

      handler: Token.asString({
        resolve: (): string => {
          if (this.handler === undefined) {
            throw new Error(`the lambda function handler was not resolved`)
          }
          return this.handler.handler
        },
      }),
      role: role.arn,
      runtime: "nodejs16.x",

      filename: code.outputPath,
      sourceCodeHash: code.outputBase64Sha256,

      ...(Object.keys(environment).length || config?.environment?.variables
        ? {
            environment: {
              variables: { ...environment, ...config?.environment?.variables },
            },
          }
        : {}),
    })
  }

  async _synth() {
    this.handler = await this.handlerPromise
  }
}
