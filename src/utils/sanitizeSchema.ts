import lodash from "lodash"
import { OpenAPIV3 } from "openapi-types"

import { walkSchema } from "./walkSchema"

/**
 * sanitizeSchema function copies the input schema and merges allOfs if possible.
 *
 * @param input
 * @returns
 */
export const sanitizeSchema = <T extends OpenAPIV3.SchemaObject>(input: T): T => {
  const copy: T = lodash.cloneDeep(input) as T

  walkSchema(
    copy,
    ({ schema }) => {
      const allOf = schema.allOf as Array<OpenAPIV3.SchemaObject>

      if (schema.title && allOf && allOf.length > 0) {
        // create groups of SchemaObjects where every element in the group is either all type "object",
        // or it is a single element group.
        const allOfGroups = allOf
          .reduce(
            ([head, ...rest], s) =>
              !head.length || (head[0].type === "object" && s.type === "object")
                ? [[...head, s], ...rest] // append to the head
                : [[s], head, ...rest], // create new group
            [[]] as Array<Array<OpenAPIV3.SchemaObject>>,
          )
          .reverse()

        // unpack allOfGroups ane merge groups
        const newAllOffs = allOfGroups.map((allOfGroup, index) => {
          if (allOfGroup.length === 1) {
            return allOfGroup[0]
          }

          const res: OpenAPIV3.SchemaObject = {
            title: `${schema.title}${index}`,
            type: "object",
            properties: allOfGroup
              .filter(s => !!s.properties)
              .map(s => s.properties)
              .reduce((acc, p) => ({ ...acc, ...p }), {}),
            required: allOfGroup
              .filter(s => s.required)
              .map(s => s.required as string[])
              .flat(1),
          }

          const additionalProperties = allOfGroup.find(s => s?.additionalProperties !== undefined)

          if (additionalProperties) {
            res.additionalProperties = additionalProperties.additionalProperties
          }

          return res
        })

        if (newAllOffs.length === 1 && newAllOffs[0].type === "object") {
          schema.type = "object"
          schema.properties = newAllOffs[0].properties
          schema.required = newAllOffs[0].required
          if (schema.additionalProperties === undefined && newAllOffs[0].additionalProperties !== undefined) {
            schema.additionalProperties = newAllOffs[0].additionalProperties
          }
          delete schema.allOf
          if (schema.required?.length === 0) {
            delete schema.required
          }
        } else {
          schema.allOf = newAllOffs
        }

        return schema
      }
    },
    undefined,
    true,
  )

  return copy
}
