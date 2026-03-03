/**
 * Next.js instrumentation hook — runs once when the server starts.
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run server-side validation (not during build or edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvironment } = await import("@/lib/env-validation");
    validateEnvironment();
  }
}
