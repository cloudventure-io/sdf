{{ interfaces }}

const readEnv = (envName: string, id: string) => {
  const value = process.env[envName];
  if (value === undefined) {
    throw new Error(`environment variable for resources '${id}' is not set, make sure that resource is attached to the lambda function`);
  }
  return value;
}

{{#resources}}
export const get{{ type }} = (): {{ type }} => JSON.parse(readEnv("{{ envName }}", "{{ id }}")) as {{ type }};
{{/resources}}
