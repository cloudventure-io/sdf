import { mkdir, mkdtemp, rm, writeFile } from "fs/promises"
import { join, relative } from "path"

const beforeEach = async (prefix: string): Promise<{ rootDir: string; outDir: string }> => {
  const testsTmpDir = join(process.cwd(), "tmp", "tests")
  await mkdir(testsTmpDir, { recursive: true })
  const rootDir = await mkdtemp(join(testsTmpDir, `${prefix}-`))
  const rootRel = relative(rootDir, process.cwd())

  await writeFile(
    join(rootDir, "tsconfig.json"),
    JSON.stringify(
      {
        extends: `${rootRel}/tsconfig.json`,
        compilerOptions: {
          emitDeclarationOnly: false,
          noEmit: true,
          rootDirs: ["./", `${rootRel}/src`],
          paths: {
            "@cloudventure/sdf": [`${rootRel}/src`],
          },
        },
        include: ["./", `${rootRel}/src`],
      },
      null,
      2,
    ),
  )

  const outDir = join(rootDir, "cdktf.out")
  await mkdir(outDir, { recursive: true })

  return {
    rootDir,
    outDir,
  }
}

const afterEach = async (rootDir: string) => {
  await rm(rootDir, { recursive: true, force: true })
}

export { beforeEach, afterEach }
