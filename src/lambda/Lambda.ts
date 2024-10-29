import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch-log-group"
import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { IamRole } from "@cdktf/provider-aws/lib/iam-role"
import { IamRolePolicy } from "@cdktf/provider-aws/lib/iam-role-policy"
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment"
import {
  LambdaFunction as AwsLambdaFunction,
  LambdaFunctionConfig as AwsLambdaFunctionConfig,
} from "@cdktf/provider-aws/lib/lambda-function"
import { Fn, TerraformResource, dependable } from "cdktf"
import { constantCase, kebabCase } from "change-case"
import { Construct } from "constructs"

import { Bundler } from "../bundler/Bundler"
import { App, AppLifeCycle } from "../core/App"
import { Resource } from "../core/Resource"
import { AsyncResolvable } from "../core/resolvable/AsyncResolvable"

export type LambdaFunctionConfig = Omit<AwsLambdaFunctionConfig, "role">

export type LambdaEntryPoint = [path: string, handler: string]

export type LambdaConfigCore = {
  -readonly [P in keyof LambdaFunctionConfig]: LambdaFunctionConfig[P]
}

export type LambdaConfig = LambdaConfigCore & {
  entryPoint?: LambdaEntryPoint | void | (() => Promise<LambdaEntryPoint | void>)
  resources?: { [name in string]: Array<string> }
}

export class Lambda extends Construct {
  private bundler: Bundler
  private app: App

  public function: AwsLambdaFunction
  public role: IamRole

  public constructor(scope: Construct, id: string, { resources, ...config }: LambdaConfig) {
    super(scope, id)

    this.app = App.getAppFromContext(this)
    this.bundler = App.getFromContext(this, Bundler)

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
      name: kebabCase(`${config.functionName}-lambda`),
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

    if (resources) {
      Object.entries(resources).forEach(([resourceName, permissions]) => {
        this.addResource(resourceName, permissions)
      })
    }

    const logGroupName = `/aws/lambda/${config.functionName}`

    new CloudwatchLogGroup(this, "logs", {
      name: logGroupName,
      retentionInDays: 30,
    })

    new AsyncResolvable(
      this,
      "resource-config",
      async () => {
        // Resolve polcies in the generation stage.
        // We expect all lambda resources to be added during the syntesis stage.
        if (this.policies.length) {
          const policy = new DataAwsIamPolicyDocument(this, "policy-document", {
            sourcePolicyDocuments: this.policies.map(policy => policy.json),
          })
          const rolePolicy = new IamRolePolicy(this, "policy", {
            role: this.role.name,
            policy: policy.json,
          })
          this.function.dependsOn?.push(dependable(rolePolicy))
        }
      },
      AppLifeCycle.generation,
    )

    const bundledLambdaConfig = this.bundler.bundleLambdaConfig(this, config)
    const bundledEnvVars = bundledLambdaConfig.environment?.variables

    // add environment variables for resources
    bundledLambdaConfig.environment = {
      variables: new AsyncResolvable(
        this,
        "env-vars",
        async () => {
          const resourceEnvironment = Object.entries(this.resources).reduce(
            (acc, [resourceName, resource]) => ({
              ...acc,
              [constantCase(`RESOURCE_${resourceName}`)]: JSON.stringify(resource.config).replace(/"/g, `\\"`),
            }),
            {},
          )
          if (bundledEnvVars) {
            return Fn.merge([bundledEnvVars, resourceEnvironment])
          } else {
            return resourceEnvironment
          }
        },
        AppLifeCycle.generation,
      ).asStringMap(),
    }

    this.function = new AwsLambdaFunction(this, "lambda", {
      dependsOn,
      role: this.role.arn,
      ...bundledLambdaConfig,
    })
  }

  public readonly resources: Record<string, Resource> = {}

  private policies: Array<DataAwsIamPolicyDocument> = []

  public addResource(name: string, permissions: Array<string>) {
    if (this.resources[name]) {
      throw new Error(`the resource ${name} is already defined for function ${this.node.id}`)
    }
    const resource = this.app.getResource(this, name)
    this.resources[name] = resource

    permissions.forEach(permissionName => {
      const permission = resource.permissions[permissionName]
      if (!permission) {
        throw new Error(
          `permission '${permissionName}' is not defined for resource ${name}, function '${this.node.id}' in the stack '${this.bundler.node.id}'`,
        )
      }
      this.policies.push(permission)
    })
  }
}
