/**
 * Runs once when the web server starts. Configuration is validated here so a
 * misconfigured deployment fails at boot with a readable message, not on the
 * first request that needs the missing value.
 */
export async function register() {
  // The check uses Node APIs, so it lives in its own module that only the Node runtime loads.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateStartup } = await import("./server/startup");
    validateStartup();
  }
}
