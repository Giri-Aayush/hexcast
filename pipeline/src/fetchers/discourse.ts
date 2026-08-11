import { BaseFetcher } from './base.js';
import type { FetchResult } from '@hexcast/shared';
import { logger } from '../utils/logger.js';
import { delay } from '../utils/delay.js';

interface DiscourseTopic {
  id: number;
  title: string;
  slug: string;
  created_at: string;
  last_posted_at: string;
  views: number;
  like_count: number;
  reply_count: number;
  posts_count: number;
  category_id: number;
  posters: Array<{ user_id: number; description: string }>;
}

interface DiscourseTopicDetail {
  post_stream: {
    posts: Array<{
      cooked: string;
      username: string;
      name: string;
    }>;
  };
}

const MAX_PAGES = 3;
const DELAY_BETWEEN_REQUESTS_MS = 1000;

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const sleep = delay;

export class DiscourseFetcher extends BaseFetcher {
  async fetch(): Promise<FetchResult[]> {
    const results: FetchResult[] = [];
    let page = 0;
    let moreTopicsUrl: string | null = null;

    while (page < MAX_PAGES) {
      let rawPath: string;
      if (page === 0) {
        rawPath = '/latest.json';
      } else if (moreTopicsUrl) {
        // Discourse returns more_topics_url like "/latest?page=1" without .json
        // We need to add .json before the query string
        rawPath = moreTopicsUrl.includes('.json')
          ? moreTopicsUrl
          : moreTopicsUrl.replace(/(\?|$)/, '.json$1');
      } else {
        break;
      }

      const url = this.buildUrl(rawPath);
      logger.debug(`Fetching ${this.config.sourceId} page ${page + 1}: ${url}`);

      let data: { topic_list: { topics: DiscourseTopic[]; more_topics_url?: string } };
      try {
        const response = await fetch(url);
        if (!response.ok) {
          logger.error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
          break;
        }
        data = await response.json() as typeof data;
      } catch (err) {
        logger.warn(`${this.config.sourceId} page ${page + 1}: failed to parse response, stopping pagination`);
        break;
      }

      const topics = data.topic_list.topics;
      moreTopicsUrl = data.topic_list.more_topics_url ?? null;

      let newTopicsOnPage = 0;

      for (const topic of topics) {
        const createdAt = new Date(topic.created_at);
        const lastPostedAt = new Date(topic.last_posted_at);
        const relevantDate = lastPostedAt > createdAt ? lastPostedAt : createdAt;

        if (!this.isAfterLastPoll(relevantDate)) continue;

        newTopicsOnPage++;

        // Fetch full topic content
        await sleep(DELAY_BETWEEN_REQUESTS_MS);
        const topicUrl = this.buildUrl(`/t/${topic.slug}/${topic.id}.json`);
        const topicResponse = await fetch(topicUrl);

        if (!topicResponse.ok) {
          logger.warn(`Failed to fetch topic ${topic.id}: ${topicResponse.status}`);
          continue;
        }

        const topicData = await topicResponse.json() as DiscourseTopicDetail;
        const firstPost = topicData.post_stream.posts[0];

        if (!firstPost) continue;

        const canonicalUrl = `${this.config.baseUrl}/t/${topic.slug}/${topic.id}`;

        results.push({
          sourceId: this.config.sourceId,
          canonicalUrl,
          rawTitle: topic.title,
          rawText: stripHtml(firstPost.cooked),
          rawMetadata: {
            topic_id: topic.id,
            views: topic.views,
            like_count: topic.like_count,
            reply_count: topic.reply_count,
            posts_count: topic.posts_count,
            category_id: topic.category_id,
            author_username: firstPost.username,
            author_name: firstPost.name,
          },
          publishedAt: createdAt,
        });
      }

      logger.info(`${this.config.sourceId} page ${page + 1}: ${newTopicsOnPage} new topics found`);

      if (newTopicsOnPage === 0 || !moreTopicsUrl) break;
      page++;
    }

    return results;
  }
}
