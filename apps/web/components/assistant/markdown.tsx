import Link from "next/link";
import { Fragment } from "react";

/**
 * Minimale, veilige Markdown voor antwoorden van de assistent: alinea's, lijsten, **vet**, _cursief_, `code`, tabellen
 * en links. Geen HTML-injectie: alles wordt als React-tekst gerenderd. Links alleen naar app-paden (/…) of https.
 */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Cursief alleen met _ buiten woorden, zodat ANTHROPIC_API_KEY of snake_case intact blijft
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(?<![\w])_([^_]+)_(?![\w])|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1] && m[2]) {
      const href = m[2];
      if (href.startsWith("/") && !href.startsWith("//")) out.push(<Link key={k} href={href} className="font-medium text-accent-strong underline-offset-2 hover:underline">{m[1]}</Link>);
      else if (href.startsWith("https://")) out.push(<a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">{m[1]}</a>);
      else out.push(m[1]);
    } else if (m[3]) out.push(<strong key={k}>{m[3]}</strong>);
    else if (m[4]) out.push(<em key={k} className="text-fg-muted">{m[4]}</em>);
    else if (m[5]) out.push(<code key={k} className="rounded bg-bg-subtle px-1 py-0.5 text-[0.9em]">{m[5]}</code>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className="space-y-3 text-[15px] leading-relaxed">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (!lines.length) return null;
        if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
          const ordered = /^\s*\d+\./.test(lines[0]!);
          const items = lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ""), `${bi}-${li}`)}</li>);
          return ordered ? <ol key={bi} className="list-decimal space-y-1 pl-5">{items}</ol> : <ul key={bi} className="list-disc space-y-1 pl-5">{items}</ul>;
        }
        if (lines.length >= 2 && lines.every((l) => l.trim().startsWith("|"))) {
          const rows = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
          return (
            <div key={bi} className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr>{rows[0]!.map((c, ci) => <th key={ci} className="border-b border-border px-2 py-1.5 text-left font-semibold">{inline(c, `${bi}-h${ci}`)}</th>)}</tr></thead>
                <tbody>{rows.slice(1).map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border-b border-border px-2 py-1.5">{inline(c, `${bi}-${ri}-${ci}`)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        }
        if (/^#{1,3}\s/.test(lines[0]!)) return <p key={bi} className="font-semibold">{inline(lines[0]!.replace(/^#{1,3}\s/, ""), `${bi}`)}</p>;
        return <p key={bi}>{lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l, `${bi}-${li}`)}</Fragment>)}</p>;
      })}
    </div>
  );
}
