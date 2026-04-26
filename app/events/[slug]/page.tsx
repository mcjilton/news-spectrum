import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  ExternalLink,
  Gauge,
  Library,
  Scale,
  TriangleAlert,
} from "lucide-react";
import {
  bucketClasses,
  bucketLabels,
  events,
  getBucketSources,
  getEvent,
  type SpectrumBucket,
} from "@/lib/events";

const buckets: SpectrumBucket[] = ["left", "center", "right"];

export const revalidate = 300;

export function generateStaticParams() {
  return events.map((event) => ({ slug: event.slug }));
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEvent(slug);

  if (!event) {
    notFound();
  }

  return (
    <main className="shell detailShell">
      <header className="topbar">
        <Link href="/" className="backLink">
          <ArrowLeft size={18} aria-hidden="true" />
          Events
        </Link>
        <span className="prototypeBadge">Seeded prototype analysis</span>
      </header>

      <section className="detailHero">
        <div>
          <p className="topic">{event.topic}</p>
          <h1>{event.title}</h1>
          <p className="lede">{event.summary}</p>
        </div>
        <div className="scorePanel">
          <div className="statWithTooltip" tabIndex={0}>
            <Gauge size={18} aria-hidden="true" />
            <span>Confidence</span>
            <strong>{event.confidence}%</strong>
            <span className="tooltip" role="tooltip">
              Estimate of how stable the shared facts are, based on source
              breadth, agreement across coverage, recency, and the amount of
              unresolved contradiction.
            </span>
          </div>
          <div className="statWithTooltip" tabIndex={0}>
            <Scale size={18} aria-hidden="true" />
            <span>Framing divergence</span>
            <strong>{event.divergence}%</strong>
            <span className="tooltip" role="tooltip">
              Estimated spread in framing across source groups. Higher scores
              mean outlets emphasize different causes, consequences, actors, or
              language around the same core event.
            </span>
          </div>
          <div className="statWithTooltip" tabIndex={0}>
            <Library size={18} aria-hidden="true" />
            <span>Sources detected</span>
            <strong>{event.sources.length}</strong>
            <span className="tooltip" role="tooltip">
              Number of articles currently grouped into this event cluster. The
              live system will deduplicate syndicated copies and weigh repeated
              coverage so source volume does not dominate analysis.
            </span>
          </div>
        </div>
      </section>

      <section className="twoColumn">
        <article className="analysisBlock">
          <div className="sectionTitle">
            <BadgeCheck size={20} aria-hidden="true" />
            <h2>Core Facts</h2>
          </div>
          <ul className="factList">
            {event.sharedFacts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </article>

        <article className="analysisBlock warnBlock">
          <div className="sectionTitle">
            <TriangleAlert size={20} aria-hidden="true" />
            <h2>Variable Or Disputed</h2>
          </div>
          <ul className="factList">
            {event.disputedOrVariable.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="spectrumCompare" aria-label="Spectrum framing comparison">
        <div className="sectionTitle">
          <Scale size={20} aria-hidden="true" />
          <h2>How The Story Shifts</h2>
        </div>
        <div className="compareGrid">
          {event.spectrum.map((analysis) => (
            <article className={`compareCard ${bucketClasses[analysis.bucket]}`} key={analysis.bucket}>
              <p className="bucketLabel">{bucketLabels[analysis.bucket]}</p>
              <h3>{analysis.label}</h3>
              <p>{analysis.summary}</p>
              <div className="tagGroup" aria-label={`${analysis.label} emphasis`}>
                {analysis.emphasis.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              <div className="languageList">
                <strong>Common language</strong>
                <span>{analysis.language.join(", ")}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="sourceSection">
        <div className="sectionTitle">
          <ExternalLink size={20} aria-hidden="true" />
          <h2>Original Sources</h2>
        </div>
        {buckets.map((bucket) => (
          <div className="sourceBucket" key={bucket}>
            <h3>{bucketLabels[bucket]}</h3>
            <div className="sourceTable">
              {getBucketSources(event, bucket).map((source) => (
                <a href={source.url} className="sourceRow" key={source.id} target="_blank" rel="noreferrer">
                  <span>
                    <strong>{source.outlet}</strong>
                    <small>{source.rating} · {source.type} · {source.publishedAt}</small>
                  </span>
                  <span>{source.title}</span>
                  <span className="framePill">{source.frame}</span>
                  <ArrowUpRight size={16} aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="methodNote">
        <h2>Prototype Method Note</h2>
        <p>
          This screen uses seeded data to validate the product shape. In the live
          pipeline, event clusters, claim extraction, source labels, and framing
          summaries will be generated algorithmically and stored with audit
          metadata. Article links remain the primary path for verification.
        </p>
      </section>
    </main>
  );
}
