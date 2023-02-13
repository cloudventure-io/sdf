# Serverless Development Framework

An opinionated Serverless Development Framework based on terraform-cdk and OpenAPI.

## Concepts
SDF is based on terraform-cdf and provides functionaly for easily creating, building
and testing AWS based serverless infrastructures.

### Abstraction Levels

There are 3 levels of abstraction in SDF - App, Stack and Bundler.

#### App
App defines the application and combines multiple Stacks. App is the equivalnet of
terraform-cdk App class. Usually you need to define only a single App.

#### Stack
Stack defines an infrastructure stack. Stack is the equivalnet of terraform-cdk Stack
class. Stacks are deployable units, every stack will have own terraform state.
The concept of Stack is provided as a class called `SdfStack`, which can
be extended.

#### Bundler
Bundler defines a boundary for the source code bundling. Lambda functions are groupped
by the bundler and the source code of all lambda functions are transpiled together.
The concept of Bundler is provided a class called `SdfBundler`, which can be extended.
