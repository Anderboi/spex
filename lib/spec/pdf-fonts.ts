import { Font } from "@react-pdf/renderer";
import path from "node:path";

let registered = false;

export function registerPdfFonts() {
  if (registered) return;

  const dir = path.join(process.cwd(), "public", "fonts");

  Font.register({
    family: "Rubik",
    fonts: [
      { src: path.join(dir, "Rubik-Regular.ttf"), fontWeight: "normal" },
      { src: path.join(dir, "Rubik-Bold.ttf"), fontWeight: "bold" },
    ],
  });

  // не переносить длинные слова без пробелов — иначе react-pdf иногда падает
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}
