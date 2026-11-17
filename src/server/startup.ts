import { EnvValidationError, getEnv } from "./env";
import { logger } from "./logger";

export function validateStartup(): void {
  try {
    const env = getEnv();
    logger.info({ ai: env.AI_PROVIDER !== "none", email: Boolean(env.SMTP_URL), signup: env.ALLOW_SIGNUP }, "web server configuration loaded");
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
