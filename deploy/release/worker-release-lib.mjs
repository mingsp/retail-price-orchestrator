import { access, cp, lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export async function materializeRuntimeDependencyLinks(nodeModulesDirectory) {
  for (const entry of await readdir(nodeModulesDirectory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = resolve(nodeModulesDirectory, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const scopedEntry of await readdir(entryPath, { withFileTypes: true })) {
        await materializeLink(resolve(entryPath, scopedEntry.name), nodeModulesDirectory);
      }
      continue;
    }
    await materializeLink(entryPath, nodeModulesDirectory);
  }
}

async function materializeLink(entryPath, nodeModulesDirectory) {
  const metadata = await lstat(entryPath);
  let target;
  if (metadata.isSymbolicLink()) {
    target = await realpath(entryPath);
  } else if (metadata.isFile() && metadata.size <= 1024) {
    target = await resolvePnpmPathReference(entryPath, nodeModulesDirectory);
  }
  if (!target) return;

  await rm(entryPath, { recursive: true, force: true });
  await cp(target, entryPath, { recursive: true, dereference: true });
}

async function resolvePnpmPathReference(entryPath, nodeModulesDirectory) {
  const reference = (await readFile(entryPath, "utf8")).trim();
  if (!reference || reference.includes("\0") || !/(^|[\\/])\.pnpm[\\/]/.test(reference)) return undefined;

  const candidate = await realpath(resolve(dirname(entryPath), reference));
  const pnpmRoot = await realpath(resolve(nodeModulesDirectory, ".pnpm"));
  const candidateRelativePath = relative(pnpmRoot, candidate);
  if (!candidateRelativePath || candidateRelativePath.startsWith("..") || isAbsolute(candidateRelativePath)) {
    throw new Error(`Refusing to materialize a dependency reference outside ${pnpmRoot}`);
  }
  if (!(await lstat(candidate)).isDirectory()) {
    throw new Error(`Dependency reference does not resolve to a directory: ${entryPath}`);
  }
  await access(resolve(candidate, "package.json"));
  return candidate;
}
