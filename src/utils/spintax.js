/**
 * Utility Spintax Parser
 * Mendukung format spintax bersarang (nested) seperti:
 * "{Halo|Hai|Selamat {pagi|siang}} {Bpk|Ibu}, apa kabar?"
 */
function parseSpintax(text) {
  if (typeof text !== "string") return text;

  const spintaxRegex = /\{([^{}]+)\}/;
  let matches;

  while ((matches = spintaxRegex.exec(text)) !== null) {
    const choices = matches[1].split("|");
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    text = text.replace(matches[0], randomChoice);
  }

  return text;
}

module.exports = { parseSpintax };
