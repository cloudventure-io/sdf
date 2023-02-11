import { access } from "fs/promises";

export const fileExists = async (path: string) =>
  access(path).then(
    () => true,
    () => false
  );
