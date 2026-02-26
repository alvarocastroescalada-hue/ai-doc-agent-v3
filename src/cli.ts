import { runAgent } from "./engine/runAgent";

const args = process.argv.slice(2);
const filePath = args.find(a => !a.startsWith("-"));
const useGolden = !args.includes("--no-golden");

if (!filePath) {
  console.error("Uso: npm run analyze -- <ruta_documento>");
  process.exit(1);
}

runAgent(filePath, { useGolden }).catch((e) => {
  console.error("ERROR DETALLADO:");
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
