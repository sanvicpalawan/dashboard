import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import type { BriefItem, DailyBrief } from "@/lib/daily-brief";

function Item({ item }: { item: BriefItem }) {
  return (
    <li className="brief-row">
      <Link className="brief-link" href={item.href}>
        <span className={`brief-dot brief-dot-${item.severity}`} aria-hidden />
        <span className="brief-body">
          <span className="brief-label">{item.label}</span>
          {item.detail && <span className="brief-detail">{item.detail}</span>}
        </span>
      </Link>
    </li>
  );
}

export function DailyBriefCard({ brief }: { brief: DailyBrief }) {
  const stamp = new Date(brief.generatedAt).toLocaleString("en-PH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  if (brief.clear) {
    return (
      <section className="card brief" aria-label="Daily brief">
        <div className="brief-head">
          <span className="eyebrow" style={{ margin: 0 }}>Daily brief</span>
          <span className="brief-stamp">{stamp}</span>
        </div>
        <p className="brief-clear"><CheckCircle2 size={15} aria-hidden /> Nothing needs attention. Agent queue, delivery, money and systems are clear.</p>
      </section>
    );
  }

  return (
    <section className="card brief" aria-label="Daily brief">
      <div className="brief-head">
        <span className="eyebrow" style={{ margin: 0 }}>Daily brief</span>
        <span className="brief-counts">
          {brief.counts.critical > 0 && <span className="brief-chip brief-chip-critical">{brief.counts.critical} critical</span>}
          {brief.counts.warning > 0 && <span className="brief-chip brief-chip-warning">{brief.counts.warning} to review</span>}
          {brief.counts.info > 0 && <span className="brief-chip brief-chip-info">{brief.counts.info} in flight</span>}
        </span>
        <span className="brief-stamp">{stamp}</span>
      </div>
      <div className="brief-groups">
        {brief.groups.map((group) => (
          <div className="brief-group" key={group.key}>
            <span className="brief-group-title">{group.title}</span>
            <ul className="brief-list">
              {group.items.map((item) => (
                <Item key={`${group.key}-${item.label}`} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
