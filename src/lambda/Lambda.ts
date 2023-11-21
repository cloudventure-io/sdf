import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch-log-group"
import { DataAwsIamPolicyDocument } from "@cdktf/provider-aws/lib/data-aws-iam-policy-document"
import { IamRole } from "@cdktf/provider-aws/lib/iam-role"
import { IamRolePolicy } from "@cdktf/provider-aws/lib/iam-role-policy"
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment"
import {
  LambdaFunction as AwsLambdaFunction,
  LambdaFunctionConfig as AwsLambdaFunctionConfig,
} from "@cdktf/provider-aws/lib/lambda-function"
import { Fn, IResolvable, TerraformResource, Token, dependable } from "cdktf"
import { constantCase, paramCase } from "change-case"
import { Construct } from "constructs"

import { App } from "../App"
import { Stack } from "../Stack"
import { Bundler } from "../bundler/Bundler"
import { Resource } from "../resource/Resource"

export type LambdaFunctionConfig = Omit<AwsLambdaFunctionConfig, "role">

export interface LambdaConfig<B extends Bundler> extends LambdaFunctionConfig {
  resources?: { [name in string]: Array<string> }
  bundler: Required<B>["_context_type"]
}

/**
 * Resolvable is a helper structure for constructing
 * IResolvable objects with async implementation and
 * a reference to a value which will be resolved
 * during async synth process.
 */
interface Resolvable {
  key: string
  resolve: () => Promise<unknown>
  ref: unknown
}

export class Lambda<B extends Bundler> extends Construct {
  private bundler: B
  private app: App
  private stack: Stack

  public function: AwsLambdaFunction
  public role: IamRole

  private resolvables: Array<Resolvable> = []
  public createResolvable(key: string, resolve: () => Promise<unknown>, ref?: unknown): IResolvable {
    const resolvable: Resolvable = {
      key,
      ref,
      resolve,
    }

    this.resolvables.push(resolvable)

    return {
      creationStack: [],
      resolve() {
        return resolvable.ref
      },
    }
  }

  public context: Required<B>["_context_type"]

  public constructor(bundler: B, id: string, { bundler: context, resources, ...config }: LambdaConfig<B>) {
    super(bundler, id)

    this.app = App.getAppFromContext(this)
    this.stack = Stack.getStackFromCtx(this)
    this.bundler = bundler
    this.context = context

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
      name: paramCase(`${config.functionName}-lambda`),
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

    new CloudwatchLogGroup(this, "logs", {
      name: `/aws/lambda/${config.functionName}`,
      retentionInDays: 30,
    })

    const bundlerConfig = this.bundler.lambdaConfig(this)

    const lambdaConfig: LambdaFunctionConfig = {
      ...bundlerConfig,
      ...config,

      // merging environment variabables from all sources
      environment: {
        variables: Token.asStringMap(
          this.createResolvable("environment.variables", async () => {
            return Fn.merge([bundlerConfig.environment?.variables, config.environment?.variables, this.environment])
          }),
        ),
      },
    }

    this.function = new AwsLambdaFunction(this, "lambda", {
      dependsOn,
      role: this.role.arn,
      ...lambdaConfig,
    })
  }

  private resources: Record<string, Resource> = {}
  private policies: Array<DataAwsIamPolicyDocument> = []
  public environment: Record<string, string> = { NODE_OPTIONS: "--enable-source-maps" }

  public addResource(name: string, permissions: Array<string>) {
    if (this.resources[name]) {
      throw new Error(`the resource ${name} is already defined for function ${this.node.id}`)
    }
    const resource = this.stack.getResource(name)
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

  async _synth() {
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

    this.environment = {
      ...this.environment,
      ...Object.entries(this.resources).reduce(
        (acc, [resourceName, resource]) => ({
          ...acc,
          [constantCase(`RESOURCE_${resourceName}`)]: JSON.stringify(resource.config).replace(/"/g, `\\"`),
        }),
        {},
      ),
    }

    // resolve all  resolvabales
    for (const result of this.resolvables) {
      result.ref = await result.resolve()
    }
  }
}
