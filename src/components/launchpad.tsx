import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { LaunchGroup, LaunchLink } from "@/lib/launchpad";

/**
 * The systems drawer at the foot of the overview.
 *
 * It answers one question — "where does this live?" — so it stays quiet: one
 * surface, three columns, no box per group. The dashboard above is the page.
 */

function Row({ link }: { link: LaunchLink }) {
  const body = (
    <>
      <span className={`systems-state ${link.state === "disconnected" ? "is-off" : ""}`} aria-hidden />
      <span className="systems-name">{link.label}</span>
      {link.meta && <span className="systems-meta">{link.meta}</span>}
      {link.external && <ArrowUpRight size={12} className="systems-icon" aria-hidden />}
    </>
  );
  return (
    <li>
      {link.external ? (
        <a className="systems-row" href={link.href} target="_blank" rel="noopener noreferrer" title={link.href}>
          {body}
        </a>
      ) : (
        <Link className="systems-row" href={link.href} title={link.href}>
          {body}
        </Link>
      )}
    </li>
  );
}

export function Launchpad({ groups }: { groups: LaunchGroup[] }) {
  if (!groups.length) return null;
  return (
    <section className="systems" aria-label="Systems">
      <header className="systems-head">
        <h2>Systems</h2>
        <p>Where every account, repository and deployment lives.</p>
      </header>
      <div className="systems-grid">
        {groups.map((group) => (
          <div className="systems-group" key={group.key}>
            <div className="systems-group-head">
              <h3>{group.title}</h3>
              {group.manageHref && (
                <Link className="systems-manage" href={group.manageHref}>
                  Manage
                </Link>
              )}
            </div>
            <ul className="systems-list">
              {group.links.map((link) => (
                <Row key={`${group.key}-${link.href}-${link.label}`} link={link} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
