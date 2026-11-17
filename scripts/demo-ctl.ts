/** Command-line control for the demo target simulator. See scripts/demo-targets.ts. */
const base = `http://localhost:${process.env.DEMO_TARGETS_PORT ?? 4010}`;
const [command, slug, minutes] = process.argv.slice(2);
const modes: Record<string, string> = { break: "down", slow: "slow", flaky: "flaky", hang: "timeout", heal: "ok" };

async function main() {
  if (!command || command === "status") {
    const list = (await (await fetch(`${base}/_control`)).json()) as { slug: string; name: string; mode: string }[];
    for (const item of list) console.log(`${item.mode === "ok" ? "  ok  " : item.mode.toUpperCase().padEnd(6)} ${item.slug.padEnd(20)} ${item.name}`);
    return;
  }
  const mode = modes[command];
  if (!mode || !slug) {
    console.error("Usage: npm run demo:ctl -- <status | break | slow | flaky | hang | heal> <service> [minutes]");
    process.exit(1);
  }
  const response = await fetch(`${base}/_control/${slug}?mode=${mode}&minutes=${Number(minutes ?? 0)}`, { method: "POST" });
  console.log(response.ok ? `${slug} → ${mode}${minutes ? ` for ${minutes} min` : ""}` : `Failed: ${(await response.text()).slice(0, 200)}`);
  if (!response.ok) process.exit(1);
}

main().catch((error) => {
  console.error(`Could not reach the simulator at ${base}. Is \`npm run demo:targets\` running?`, String(error));
  process.exit(1);
});
