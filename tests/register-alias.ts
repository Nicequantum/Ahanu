/**
 * Node 22 `--experimental-strip-types` does not honor tsconfig `paths`.
 * Production engines import `@/lib/...` and extensionless `./foo` relatives.
 * Register a resolve hook before any dynamic `import("../src/...")`.
 */
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC_ROOT = path.resolve(fileURLToPath(new URL("../src/", import.meta.url)));
const SRC_HREF = pathToFileURL(SRC_ROOT).href;
const TEST_HREF = pathToFileURL(path.resolve(fileURLToPath(new URL("./", import.meta.url)))).href;
const CF_HREF = pathToFileURL(path.resolve(fileURLToPath(new URL("../cloudflare/", import.meta.url)))).href;

const g = globalThis as typeof globalThis & { __ahanuAliasHooks?: boolean };
if (!g.__ahanuAliasHooks) {
  g.__ahanuAliasHooks = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        let abs = path.join(SRC_ROOT, specifier.slice(2));
        if (!path.extname(abs)) abs += ".ts";
        return nextResolve(pathToFileURL(abs).href, context);
      }

      const parent = context.parentURL ?? "";
      const fromWorkspace =
        parent.startsWith(SRC_HREF) || parent.startsWith(TEST_HREF) || parent.startsWith(CF_HREF);
      if (
        fromWorkspace &&
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !path.extname(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }

      return nextResolve(specifier, context);
    },
  });
}
