const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

function findMainApplicationFiles(root) {
  const files = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMainApplicationFiles(entryPath));
    } else if (entry.name === "MainApplication.kt") {
      files.push(entryPath);
    }
  }

  return files;
}

function patchMainApplication(source) {
  if (!source.includes("ReactNativeHostWrapper")) {
    return source;
  }

  let next = source.replace(
    "import expo.modules.ReactNativeHostWrapper",
    "import expo.modules.ExpoReactHostFactory",
  );
  next = next.replace(
    "override val reactNativeHost: ReactNativeHost = ReactNativeHostWrapper(\n        this,\n        object : DefaultReactNativeHost(this) {",
    "override val reactNativeHost: ReactNativeHost = object : DefaultReactNativeHost(this) {",
  );
  next = next.replace(
    "          override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED\n      }\n  )",
    "          override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED\n      }",
  );
  next = next.replace(
    "get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)",
    "get() = ExpoReactHostFactory.getDefaultReactHost(\n      applicationContext,\n      PackageList(this).packages,\n      useDevSupport = BuildConfig.DEBUG,\n    )",
  );

  if (next.includes("ReactNativeHostWrapper")) {
    throw new Error(
      "Failed to replace all ReactNativeHostWrapper references in MainApplication.kt.",
    );
  }

  return next;
}

module.exports = function withExpo56ReactHost(config) {
  return withDangerousMod(config, [
    "android",
    (nextConfig) => {
      const javaRoot = path.join(
        nextConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
      );
      const files = findMainApplicationFiles(javaRoot);

      if (files.length === 0) {
        throw new Error("Could not find Android MainApplication.kt to patch React host setup.");
      }

      for (const file of files) {
        fs.writeFileSync(file, patchMainApplication(fs.readFileSync(file, "utf8")));
      }

      return nextConfig;
    },
  ]);
};
