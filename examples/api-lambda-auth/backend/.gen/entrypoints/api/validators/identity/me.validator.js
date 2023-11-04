"use strict";export const query = validate10;const schema11 = {"$id":"query","type":"object","required":[],"additionalProperties":{"type":"string"}};function validate10(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){/*# sourceURL="query" */;let vErrors = null;let errors = 0;if(data && typeof data == "object" && !Array.isArray(data)){for(const key0 in data){if(typeof data[key0] !== "string"){const err0 = {instancePath:instancePath+"/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/additionalProperties/type",keyword:"type",params:{type: "string"},message:"must be string"};if(vErrors === null){vErrors = [err0];}else {vErrors.push(err0);}errors++;}}}else {const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};if(vErrors === null){vErrors = [err1];}else {vErrors.push(err1);}errors++;}validate10.errors = vErrors;return errors === 0;}export const path = validate11;const schema12 = {"$id":"path","type":"object","required":[],"additionalProperties":{"type":"string"}};function validate11(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){/*# sourceURL="path" */;let vErrors = null;let errors = 0;if(data && typeof data == "object" && !Array.isArray(data)){for(const key0 in data){if(typeof data[key0] !== "string"){const err0 = {instancePath:instancePath+"/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/additionalProperties/type",keyword:"type",params:{type: "string"},message:"must be string"};if(vErrors === null){vErrors = [err0];}else {vErrors.push(err0);}errors++;}}}else {const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};if(vErrors === null){vErrors = [err1];}else {vErrors.push(err1);}errors++;}validate11.errors = vErrors;return errors === 0;}export const header = validate12;const schema13 = {"$id":"header","type":"object","required":[],"additionalProperties":{"type":"string"}};function validate12(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){/*# sourceURL="header" */;let vErrors = null;let errors = 0;if(data && typeof data == "object" && !Array.isArray(data)){for(const key0 in data){if(typeof data[key0] !== "string"){const err0 = {instancePath:instancePath+"/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/additionalProperties/type",keyword:"type",params:{type: "string"},message:"must be string"};if(vErrors === null){vErrors = [err0];}else {vErrors.push(err0);}errors++;}}}else {const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};if(vErrors === null){vErrors = [err1];}else {vErrors.push(err1);}errors++;}validate12.errors = vErrors;return errors === 0;}export const cookie = validate13;const schema14 = {"$id":"cookie","type":"object","required":[],"additionalProperties":{"type":"string"}};function validate13(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){/*# sourceURL="cookie" */;let vErrors = null;let errors = 0;if(data && typeof data == "object" && !Array.isArray(data)){for(const key0 in data){if(typeof data[key0] !== "string"){const err0 = {instancePath:instancePath+"/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/additionalProperties/type",keyword:"type",params:{type: "string"},message:"must be string"};if(vErrors === null){vErrors = [err0];}else {vErrors.push(err0);}errors++;}}}else {const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};if(vErrors === null){vErrors = [err1];}else {vErrors.push(err1);}errors++;}validate13.errors = vErrors;return errors === 0;}export const authorizer = validate14;const schema15 = {"$id":"authorizer","title":"AuthorizerContextAuthorizer","type":"object","properties":{"lambda":{"title":"AuthContext","type":"object","properties":{"name":{"type":"string","minLength":3}},"required":["name"],"additionalProperties":false}},"required":["lambda"]};const func2 = require("ajv/dist/runtime/ucs2length").default;function validate14(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){/*# sourceURL="authorizer" */;let vErrors = null;let errors = 0;if(data && typeof data == "object" && !Array.isArray(data)){if(data.lambda === undefined){const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "lambda"},message:"must have required property '"+"lambda"+"'"};if(vErrors === null){vErrors = [err0];}else {vErrors.push(err0);}errors++;}if(data.lambda !== undefined){let data0 = data.lambda;if(data0 && typeof data0 == "object" && !Array.isArray(data0)){if(data0.name === undefined){const err1 = {instancePath:instancePath+"/lambda",schemaPath:"#/properties/lambda/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};if(vErrors === null){vErrors = [err1];}else {vErrors.push(err1);}errors++;}for(const key0 in data0){if(!(key0 === "name")){const err2 = {instancePath:instancePath+"/lambda",schemaPath:"#/properties/lambda/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};if(vErrors === null){vErrors = [err2];}else {vErrors.push(err2);}errors++;}}if(data0.name !== undefined){let data1 = data0.name;if(typeof data1 === "string"){if(func2(data1) < 3){const err3 = {instancePath:instancePath+"/lambda/name",schemaPath:"#/properties/lambda/properties/name/minLength",keyword:"minLength",params:{limit: 3},message:"must NOT have fewer than 3 characters"};if(vErrors === null){vErrors = [err3];}else {vErrors.push(err3);}errors++;}}else {const err4 = {instancePath:instancePath+"/lambda/name",schemaPath:"#/properties/lambda/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};if(vErrors === null){vErrors = [err4];}else {vErrors.push(err4);}errors++;}}}else {const err5 = {instancePath:instancePath+"/lambda",schemaPath:"#/properties/lambda/type",keyword:"type",params:{type: "object"},message:"must be object"};if(vErrors === null){vErrors = [err5];}else {vErrors.push(err5);}errors++;}}}else {const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};if(vErrors === null){vErrors = [err6];}else {vErrors.push(err6);}errors++;}validate14.errors = vErrors;return errors === 0;}