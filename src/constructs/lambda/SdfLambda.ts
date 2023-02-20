import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch-log-group"
import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { IamRole } from "@cdktf/provider-aws/lib/iam-role"
import { IamRolePolicy } from "@cdktf/provider-aws/lib/iam-role-policy"
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment"
import { LambdaFunction, LambdaFunctionConfig } from "@cdktf/provider-aws/lib/lambda-function"
import { Fn, TerraformResource, Token } from "cdktf"
import { constantCase } from "change-case"
import { Construct } from "constructs"

import { SdfApp } from "../../SdfApp"
import { SdfBundler } from "../../SdfBundler"
import { SdfResource } from "../../SdfResource"

export interface SdfLambdaHandler {
  /** The name of the function */
  handler: string

  /** The file path of the entry point */
  entryPoint: string
}

type SdfLambdaFunctionConfig = Omit<LambdaFunctionConfig, "role" | "handler"> & {
  handler: SdfLambdaHandler | (() => Promise<SdfLambdaHandler>)
}

export interface SdfLambdaConfig extends SdfLambdaFunctionConfig {
  resources?: { [name in string]: Array<string> }
}

export class SdfLambda extends Construct {
  private bundler: SdfBundler
  private app: SdfApp

  public function: LambdaFunction
  public role: IamRole

  // private handlerPromise: Promise<SdfLambdaHandler>
  public handler?: SdfLambdaHandler
  public config: SdfLambdaConfig

  public constructor(scope: Construct, id: string, config: SdfLambdaConfig) {
    super(scope, id)
    this.bundler = SdfBundler.getBundlerFromCtx(this)
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

    this.role = new IamRole(this, "role", {
      name: this.app._concatName(config.functionName, "lambda"),
      assumeRolePolicy: assumeRolePolicy.json,
    })

    const dependsOn: Array<TerraformResource> = []

    dependsOn.push(
      new IamRolePolicyAttachment(this, "basic-execution-role-policy", {
        role: this.role.name,
        policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
      }),
    )

    if (config.vpcConfig) {
      dependsOn.push(
        new IamRolePolicyAttachment(this, "eni-management-role-policy", {
          role: this.role.name,
          policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaENIManagementAccess",
        }),
      )
    }

    if (config.resources) {
      Object.entries(config.resources).forEach(([resourceName, permissions]) => {
        this.addResource(resourceName, permissions)
      })
    }

    const code = this.bundler.code

    new CloudwatchLogGroup(this, "logs", {
      name: `/aws/lambda/${config.functionName}`,
      retentionInDays: 30,
    })

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
      role: this.role.arn,
      runtime: "nodejs16.x",

      filename: code.outputPath,
      sourceCodeHash: code.outputBase64Sha256,

      environment: {
        variables: Token.asStringMap({
          resolve: (): { [key in string]: string } => Fn.mergeMaps([this.environment, this.config.environment]),
        }),
      },
    })
  }

  private resources: Record<string, SdfResource> = {}
  private policies: Array<DataAwsIamPolicyDocument> = []
  private environment: Record<string, string> = { NODE_OPTIONS: "--enable-source-maps" }

  public addResource(name: string, permissions: Array<string>) {
    if (this.resources[name]) {
      throw new Error(`the resource ${name} is already defined for function ${this.node.id}`)
    }
    const resource = this.bundler._getResource(name)
    this.resources[name] = resource

    permissions.forEach(permissionName => {
      const permission = resource.permissions[permissionName]
      if (!permission) {
        throw new Error(
          `permission '${permissionName}' is not defined for resource ${name}, function '${this.node.id}' in the stack '${this.bundler.id}'`,
        )
      }
      this.policies.push(permission)
    })
  }

  async _synth() {
    this.handler = await Promise.resolve(
      typeof this.config.handler === "function" ? this.config.handler() : this.config.handler,
    )

    if (this.policies.length) {
      const policy = new DataAwsIamPolicyDocument(this, "policy", {
        sourcePolicyDocuments: this.policies.map(policy => policy.json),
      })
      new IamRolePolicy(this, "policy", {
        role: this.role.name,
        policy: policy.json,
      })
    }

    this.environment = {
      ...this.environment,
      ...Object.entries(this.resources).reduce(
        (acc, [resourceName, resource]) => ({
          ...acc,
          [constantCase(`RESOURCE_${resourceName}`)]: JSON.stringify(resource.config),
        }),
        {},
      ),
    }
  }
}
