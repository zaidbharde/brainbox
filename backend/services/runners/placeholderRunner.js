export function createPlaceholderRunner(languageName) {
  return async () => ({
    success: false,
    output: '',
    error: `${languageName} runner is not configured yet. Attach compiler container/service in services/runners.`,
  });
}
