import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The workspace packages ship raw TypeScript with `.ts` import specifiers —
   * there is no build step anywhere in this repo, because Bun runs TS directly.
   * Next has to compile them itself.
   */
  transpilePackages: ["@tessr/core", "@tessr/app", "@tessr/policy", "@tessr/settlement", "@tessr/perception"],

  /**
   * `@tessr/app` reaches for `node:crypto` and `node:fs` (reading the RSA public
   * key). Those only ever run in route handlers, never in a browser bundle, but
   * webpack still needs telling not to try.
   */
  serverExternalPackages: ["viem"],

  /**
   * transformers.js ships a Node build alongside the web one, and its Node build
   * pulls in `onnxruntime-node` and `sharp`, both of which are native modules
   * that cannot exist in a browser bundle.
   *
   * The package's own export conditions already resolve to the web build for a
   * browser target, so this is belt and braces rather than load-bearing. It is
   * here because the failure it prevents is a build error in the detector worker
   * with a stack trace that points at neither the worker nor the detector, and
   * finding that under time pressure is not a good evening.
   */
  turbopack: {
    resolveAlias: {
      "onnxruntime-node": { browser: "./lib/detect/unavailable.ts" },
      sharp: { browser: "./lib/detect/unavailable.ts" },
    },
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve = config.resolve ?? {};
      config.resolve.alias = {
        ...config.resolve.alias,
        "onnxruntime-node": false,
        sharp: false,
      };
    }
    return config;
  },

  typescript: {
    // The repo is typechecked as a whole by `bun run typecheck` at the root,
    // which has the correct project config for the workspace packages. Next's
    // own pass would resolve them differently and duplicate the work.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
