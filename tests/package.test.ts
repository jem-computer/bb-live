import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";

test("plugin uses only public SDK and declared external packages", () => {
  const result = experimental_scanPublicSdkOnly(
    fileURLToPath(new URL("..", import.meta.url)),
    { allow: [/^react$/, /^react\/jsx-runtime$/, /^ws$/, /^happy-dom$/] },
  );
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.privateDependencies, []);
});
