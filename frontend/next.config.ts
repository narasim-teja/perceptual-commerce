import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The workspace packages ship raw TypeScript with `.ts` import specifiers —
   * there is no build step anywhere in this repo, because Bun runs TS directly.
   * Next has to compile them itself.
   */
  transpilePackages: ["@pc/core", "@pc/app", "@pc/policy", "@pc/settlement", "@pc/perception"],

  /**
   * `@pc/app` reaches for `node:crypto` and `node:fs` (reading the RSA public
   * key). Those only ever run in route handlers, never in a browser bundle, but
   * webpack still needs telling not to try.
   */
  serverExternalPackages: ["viem"],

  typescript: {
    // The repo is typechecked as a whole by `bun run typecheck` at the root,
    // which has the correct project config for the workspace packages. Next's
    // own pass would resolve them differently and duplicate the work.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
