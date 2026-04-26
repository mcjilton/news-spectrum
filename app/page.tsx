import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  Clock3,
  Filter,
  Gauge,
  Library,
  Search,
  ShieldCheck,
} from "lucide-react";
import { bucketClasses, bucketLabels, events, type SpectrumBucket } from "@/lib/events";

const buckets: SpectrumBucket[] = ["left", "center", "right"];

function countBucketSources(
  sources: (typeof events)[number]["sources"],
  bucket: SpectrumBucket,
) {
  return sources.filter((source) => source.bucket === bucket).length;
}

export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="News Spectrum home">
          <span className="brandMark">NS</span>
          <span>News Spectrum</span>
        </Link>
        <nav className="navLinks" aria-label="Primary">
          <a href="#events">Events</a>
          <a href="#method">Method</a>
          <a href="#sources">Sources</a>
        </nav>
      </header>

      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Prototype workspace</p>
          <h1>Compare the facts everyone cites with the spin each side adds.</h1>
          <p className="lede">
            A fast, source-linked briefing surface for politically curious readers.
            The MVP starts with seeded analysis data, then moves to live ingestion,
            clustering, and LLM-assisted framing summaries.
          </p>
        </div>
        <div className="heroPanel" aria-label="System status">
          <div className="metric">
            <span>Seed events</span>
            <strong>{events.length}</strong>
          </div>
          <div className="metric">
            <span>Analysis mode</span>
            <strong>AI-assisted</strong>
          </div>
          <div className="metric">
            <span>Editorial curation</span>
            <strong>None</strong>
          </div>
        </div>
      </section>

      <section className="toolbar" aria-label="Event controls">
        <div className="searchBox">
          <Search size={18} aria-hidden="true" />
          <span>Search events, sources, topics</span>
        </div>
        <button className="iconButton" type="button" aria-label="Filter events">
          <Filter size={18} aria-hidden="true" />
        </button>
      </section>

      <section id="events" className="eventGrid" aria-label="Detected events">
        {events.map((event) => (
          <article className="eventCard" key={event.slug}>
            <div className="eventHeader">
              <div>
                <p className="topic">{event.topic}</p>
                <h2>{event.title}</h2>
              </div>
              <span className={`status ${event.status}`}>{event.status}</span>
            </div>
            <p className="summary">{event.summary}</p>

            <div className="cardStats">
              <span className="statWithTooltip" tabIndex={0}>
                <Library size={16} aria-hidden="true" />
                {event.sources.length} sources
                <span className="tooltip" role="tooltip">
                  Number of articles currently grouped into this event cluster.
                  The live system will deduplicate syndicated copies and weigh
                  repeated coverage so source volume does not dominate analysis.
                </span>
              </span>
              <span className="statWithTooltip" tabIndex={0}>
                <Gauge size={16} aria-hidden="true" />
                {event.confidence}% confidence
                <span className="tooltip" role="tooltip">
                  Estimate of how stable the shared facts are, based on source
                  breadth, agreement across coverage, recency, and the amount of
                  unresolved contradiction.
                </span>
              </span>
              <span className="statWithTooltip" tabIndex={0}>
                <BarChart3 size={16} aria-hidden="true" />
                {event.divergence}% divergence
                <span className="tooltip" role="tooltip">
                  Estimated spread in framing across source groups. Higher scores
                  mean outlets emphasize different causes, consequences, actors,
                  or language around the same core event.
                </span>
              </span>
              <span className="statWithTooltip" tabIndex={0}>
                <Clock3 size={16} aria-hidden="true" />
                {event.timespan}
                <span className="tooltip" role="tooltip">
                  Time window covered by articles currently included in this
                  event cluster. Older context may still appear on the detail
                  page when it helps explain the story.
                </span>
              </span>
            </div>

            <div className="coverageBlock">
              <p>Coverage represented</p>
              <div className="spectrumStrip" aria-label="Spectrum coverage represented">
                {buckets.map((bucket) => (
                  <span className={bucketClasses[bucket]} key={bucket}>
                    {bucketLabels[bucket]} ({countBucketSources(event.sources, bucket)})
                  </span>
                ))}
              </div>
            </div>

            <Link className="cardLink" href={`/events/${event.slug}`}>
              Open analysis
              <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </article>
        ))}
      </section>

      <section id="method" className="infoBand">
        <div className="infoItem">
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <h2>Method stance</h2>
            <p>
              The system separates broadly corroborated claims from interpretation.
              It shows how outlets frame the same event and links back to source
              material instead of republishing articles.
            </p>
          </div>
        </div>
        <div id="sources" className="infoItem">
          <Library size={22} aria-hidden="true" />
          <div>
            <h2>Source stance</h2>
            <p>
              The MVP favors breadth: mainstream, wire, local, partisan,
              opinion-heavy, and policy sources can all be included when clearly
              labeled and weighted.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
