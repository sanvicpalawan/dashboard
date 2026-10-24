import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { LaunchGroup, LaunchLink } from "@/lib/launchpad";

function Row({ link }: { link: LaunchLink }) {
  const body = (
    <>
      {link.state && <span className={link.state === "connected" ? "launch-dot launch-dot-on" : "launch-dot launch-dot-off"} aria-hidden />}
      <span className="launch-name">{link.label}</span>
      {link.meta && <span className="launch-meta">{link.meta}</span>}
      {link.external && <ArrowUpRight size={12} className="launch-icon" aria-hidden />}
    </>
  );
  if (link.external) {
    return (
      <li>
        <a className="launch-row" href={link.href} target="_blank" rel="noopener noreferrer" title={link.href}>
          {body}
        </a>
      </li>
    );
  }
  return (
    <li>
      <Link className="launch-row" href={link.href} title={link.href}>
        {body}
      </Link>
    </li>
  );
}

export function Launchpad({ groups }: { groups: LaunchGroup[] }) {
  if (!groups.length) return null;
  return (
    <section className="launchpad" aria-label="Fast access">
      {groups.map((group) => (
        <div className="card launch-group" key={group.key}>
          <div className="launch-group-head">
            <span className="eyebrow" style={{ margin: 0 }}>{group.title}</span>
            {group.manageHref && <Link className="launch-manage" href={group.manageHref}>Manage</Link>}
          </div>
          <ul className="launch-list">
            {group.links.map((link) => (
              <Row key={`${group.key}-${link.href}-${link.label}`} link={link} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
