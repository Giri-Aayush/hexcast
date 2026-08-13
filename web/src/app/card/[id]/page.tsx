import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCardById } from '@/lib/queries';
import Link from 'next/link';
import { CATEGORY_LABELS, extractDomain, relativeTime, splitFigures } from '@/lib/utils';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const card = await getCardById(id);

  if (!card) {
    return { title: 'Card not found · Hexcast' };
  }

  const categoryLabel = CATEGORY_LABELS[card.category] ?? card.category;
  const description = card.summary.length > 200 ? card.summary.slice(0, 200) + '...' : card.summary;
  const ogImageUrl = `/og?id=${id}`;

  return {
    title: `${card.headline} · Hexcast`,
    description,
    openGraph: {
      title: card.headline,
      description,
      type: 'article',
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: card.headline,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: card.headline,
      description: `[${categoryLabel}] ${description}`,
      images: [ogImageUrl],
    },
  };
}

export default async function CardPage({ params }: Props) {
  const { id } = await params;
  const card = await getCardById(id);

  if (!card) {
    notFound();
  }

  const categoryLabel = CATEGORY_LABELS[card.category] ?? card.category;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: card.headline,
    description: card.summary,
    url: `https://hexcast.xyz/card/${id}`,
    datePublished: card.published_at,
    publisher: {
      '@type': 'Organization',
      name: 'Hexcast',
      url: 'https://hexcast.xyz',
    },
    mainEntityOfPage: card.canonical_url,
    articleSection: categoryLabel,
  };

  return (
    <>
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
    {/* The permalink is what a shared link opens, so it is the card standing alone:
        same construction as the feed — tinted surface, dither, badge — with the
        actions replaced by "open the full feed". Server-rendered; no client state. */}
    <main className="hx-perma">
      <header className="hx-perma-head">
        <Link href="/feed" aria-label="Back to feed" className="hx-perma-back">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
        </Link>
        <span className="hx-wordmark">
          hexcast<span>.</span>
        </span>
        <span className="hx-perma-spacer" aria-hidden="true" />
      </header>

      <article className="hx-card hx-perma-card" data-category={card.category}>
        <div className="hx-dither" aria-hidden="true" />
        <div className="hx-badge-row">
          <span className="hx-badge">{categoryLabel.toUpperCase()}</span>
        </div>
        <div className="hx-body-block">
          <h1 className="hx-headline">{card.headline}</h1>
          <p className="hx-summary">
            {splitFigures(card.summary).map((seg, i) =>
              seg.figure ? (
                <span key={i} className="hx-fig">
                  {seg.text}
                </span>
              ) : (
                seg.text
              ),
            )}
          </p>
        </div>
        {/* Cover art in the body, same as the feed card. Server component, so no
            onError fallback — but the pool only assigns image URLs that exist, so a
            404 isn't a live risk here. */}
        {card.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="hx-cardimg" src={card.image_url} alt="" aria-hidden="true" loading="lazy" decoding="async" />
        ) : (
          <div className="hx-spacer" />
        )}
        <div className="hx-meta">
          {extractDomain(card.canonical_url).toUpperCase()} · {relativeTime(card.published_at).toUpperCase()}
        </div>
        <div className="hx-perma-cta">
          <Link href={`/feed?card=${card.id}`} className="hx-btn-ink" style={{ flex: 1, justifyContent: 'center' }}>
            Open the full feed
          </Link>
          <a href={card.canonical_url} target="_blank" rel="noopener noreferrer" className="hx-btn-quiet">
            Source
          </a>
        </div>
      </article>
    </main>
    </>
  );
}
