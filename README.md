# Serverless Development Framework

## Concepts
SDF is based on terraform-cdf and provides functionaly for easily creating, building
and testing AWS based serverless infrastructures.

### Abstraction Levels

There are 3 levels of abstraction in SDF - App, Stack and Service.

#### App
App defines the application and combines multiple Stacks. App is the equivalnet of
terraform-cdk App class. Usually you need to define only a single App.

#### Stack
Stack defines an infrastructure stack. Stack is the equivalnet of terraform-cdk Stack
class. Stacks are deployable units, every stack will have own terraform state.
The concept of Stack is provided as an abstract class called `SdfStack`, which should
be extended and implemented.

#### Service
Service defines a single service. Lambda functions are groupped into services and
the source code of all lambda functions within single service is bundled together.
The concept of Service is provided as an abstract class called `SdfService`, which
should be extended and implemented.
