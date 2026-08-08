/**
 * Stands in for the native ONNX runtime and `sharp` in a browser bundle.
 *
 * transformers.js exports a Node build that requires both. Its export conditions
 * already keep that build out of a browser target, so nothing should ever import
 * this file. It exists so that if something does, the bundler resolves it to a
 * module that throws a sentence naming the actual problem, rather than failing
 * on a missing native binding.
 */

const message =
  "the node build of onnxruntime is not available in the browser; the detector runs on onnxruntime-web";

export default new Proxy(
  {},
  {
    get() {
      throw new Error(message);
    },
  },
);
