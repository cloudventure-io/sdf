import { SyncTransformer } from "@jest/transform";

const transformer: SyncTransformer = {
  process: (content) => ({
    code: "module.exports = " + JSON.stringify(content),
  }),
};

export default transformer;
