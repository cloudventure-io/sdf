import { App, AppConfig } from "cdktf";
import {
  EXCLUDE_STACK_ID_FROM_LOGICAL_IDS,
  ALLOW_SEP_CHARS_IN_LOGICAL_IDS,
} from "cdktf/lib/features";
import { Construct } from "constructs";
import { SdfStack, SdfStackBuildMetadata } from "./SdfStack";
import { join } from "path";
import { writeFile } from "fs/promises";
import { SdfService } from "./SdfService";

export type NamingCase = "param-case" | "PascalCase";
type namingCaseFunction = (...args: Array<string>) => string;

const namingCaseFunction: {
  [c in NamingCase]: namingCaseFunction;
} = {
  "param-case": (...args: Array<string>) => args.join("-"),
  PascalCase: (...args: Array<string>) =>
    args.map((arg) => (arg[0] || "").toUpperCase() + arg.slice(1)).join(""),
};

export interface SdfAppOptions extends AppConfig {
  rootDir: string;
  tmpDir: string;

  namingCase?: NamingCase;
}

export interface SdfAppMetadata {
  path: string;
  stacks: Array<SdfStackBuildMetadata>;
}

export class SdfApp extends App {
  // The root directory of the app
  public rootDir: string;

  // The temporary directory of the app.
  // Defaults to ${rootDir}/tmp.
  public tmpDir: string;

  private namingCaseFunction: namingCaseFunction;

  constructor({
    rootDir,
    tmpDir,
    namingCase = "param-case",
    ...options
  }: SdfAppOptions) {
    super({
      ...options,
      context: {
        [EXCLUDE_STACK_ID_FROM_LOGICAL_IDS]: "false",
        [ALLOW_SEP_CHARS_IN_LOGICAL_IDS]: "true",
        ...options.context,
      },
    });

    this.node.setContext(SdfApp.name, this);
    this.rootDir = rootDir;
    this.tmpDir = tmpDir;
    this.namingCaseFunction = namingCaseFunction[namingCase];
  }

  public _concatName(...args: Array<string>) {
    return this.namingCaseFunction(...args);
  }

  public static getFromContext<
    T extends typeof SdfApp | typeof SdfStack | typeof SdfService
  >(scope: Construct, type: T): InstanceType<T> {
    const value: InstanceType<T> = scope.node.tryGetContext(type.name);
    if (!value) {
      throw new Error(`cannot find ${type.name} in context`);
    } else if (!(value instanceof type)) {
      throw new Error(
        `the value in context is not an instance of ${type.name} type`
      );
    }
    return value;
  }

  static getAppFromContext(scope: Construct): SdfApp {
    return SdfApp.getFromContext(scope, SdfApp);
  }

  get relDir(): string {
    return "src";
  }

  get absDir(): string {
    return join(this.rootDir, this.relDir);
  }

  async synth(): Promise<void> {
    super.synth();

    const stacks = this.node
      .findAll()
      .filter<SdfStack>(
        (construct): construct is SdfStack => construct instanceof SdfStack
      );

    await Promise.all(stacks.map((stack) => stack._synth()));

    const metadata: SdfAppMetadata = {
      path: this.relDir,
      stacks: stacks.map((stack) => stack._getBuildMetadata()),
    };

    await writeFile(
      join(this.tmpDir, "metadata.json"),
      JSON.stringify(metadata, null, 2)
    );
  }
}
