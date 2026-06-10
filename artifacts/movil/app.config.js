// Dynamic Expo config. Reads the static app.json (passed in as `config`) and,
// when EXPO_PUBLIC_BASE_PATH is set at build time (e.g. "/app"), serves the web
// build under that sub-path via Expo's experiments.baseUrl. Unset in dev, so
// `expo start` keeps serving from the root.
module.exports = ({ config }) => {
  const basePath = (process.env.EXPO_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
  return {
    ...config,
    experiments: {
      ...(config.experiments || {}),
      ...(basePath ? { baseUrl: basePath } : {}),
    },
  };
};
