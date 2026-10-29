/**
 * Renders the notes people paste into description fields as readable prose
 * instead of one long line.
 *
 * Records are written by hand in a textarea, so the layout has to survive
 * whatever structure arrives: blank-line paragraphs, heading lines, bullet
 * lists, numbered lists and bare URLs. Everything is escaped by React — no HTML
 * is trusted, and only http(s) URLs become links.
 */

const URL_PATTERN = /(https?:\/\/[^\s<>()]+)/g;
const BULLET = /^[•\-*]\s+/;
const NUMBERED = /^\d+\.\s+/;

function withLinks(text: string) {
  return text.split(URL_PATTERN).map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={index} href={part} target="_blank" rel="noreferrer">
          {part.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>
      );
    }
    return part;
  });
}

/** A short line with no closing punctuation reads as a section label. */
function isHeading(line: string) {
  return line.length <= 72 && !/[.:;!?]$/.test(line) && !BULLET.test(line) && !NUMBERED.test(line);
}

export function RichText({ text }: { text: string }) {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return (
    <div className="rich-text">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);

        if (lines.length === 1 && isHeading(lines[0])) {
          return <h3 key={blockIndex}>{lines[0]}</h3>;
        }

        if (lines.length > 0 && lines.every((line) => BULLET.test(line))) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, index) => (
                <li key={index}>{withLinks(line.replace(BULLET, ""))}</li>
              ))}
            </ul>
          );
        }

        if (lines.length > 0 && lines.every((line) => NUMBERED.test(line))) {
          return (
            <ol key={blockIndex}>
              {lines.map((line, index) => (
                <li key={index}>{withLinks(line.replace(NUMBERED, ""))}</li>
              ))}
            </ol>
          );
        }

        return <p key={blockIndex}>{withLinks(lines.join(" "))}</p>;
      })}
    </div>
  );
}
