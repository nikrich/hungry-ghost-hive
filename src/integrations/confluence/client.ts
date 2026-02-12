// Licensed under the Hungry Ghost Hive License. See LICENSE.

/** Confluence page metadata */
export interface ConfluencePage {
  id: string;
  type: string;
  title: string;
  space: {
    key: string;
    name: string;
  };
  body: {
    storage: {
      value: string;
      representation: string;
    };
  };
  links: {
    self: string;
    webui: string;
  };
  version: {
    number: number;
  };
}

/** Confluence page summary (minimal fields) */
export interface ConfluencePageSummary {
  id: string;
  type: string;
  title: string;
  spaceKey: string;
  url: string;
}

/** Options for fetching pages from a space */
export interface FetchPagesOptions {
  siteUrl: string;
  accessToken: string;
  spaceKey: string;
  limit?: number;
  start?: number;
}

/** Options for getting a single page */
export interface GetPageOptions {
  siteUrl: string;
  accessToken: string;
  pageId: string;
  expand?: string[];
}

/** Options for searching Confluence pages */
export interface SearchPagesOptions {
  siteUrl: string;
  accessToken: string;
  cql: string;
  limit?: number;
  start?: number;
}

/** Search results */
export interface SearchResults {
  results: ConfluencePageSummary[];
  start: number;
  limit: number;
  size: number;
  totalSize: number;
}

/**
 * Build the Confluence API URL for a given site.
 */
export function buildConfluenceApiUrl(siteUrl: string, endpoint: string): string {
  // Remove trailing slash from site URL if present
  const baseUrl = siteUrl.endsWith('/') ? siteUrl.slice(0, -1) : siteUrl;
  return `${baseUrl}/wiki/rest/api${endpoint}`;
}

/**
 * Fetch pages from a Confluence space.
 * Returns a paginated list of pages in the space.
 */
export async function fetchPagesFromSpace(
  options: FetchPagesOptions
): Promise<ConfluencePageSummary[]> {
  const { siteUrl, accessToken, spaceKey, limit = 50, start = 0 } = options;

  const url = buildConfluenceApiUrl(siteUrl, '/content');
  const params = new URLSearchParams({
    spaceKey,
    expand: 'body.storage,version',
    limit: limit.toString(),
    start: start.toString(),
  });

  const response = await fetch(`${url}?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch Confluence pages (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    results: ConfluencePage[];
  };

  return data.results.map(page => ({
    id: page.id,
    type: page.type,
    title: page.title,
    spaceKey: page.space.key,
    url: page.links.webui,
  }));
}

/**
 * Get a single Confluence page by ID.
 * Includes the page content body by default.
 */
export async function getPage(options: GetPageOptions): Promise<ConfluencePage> {
  const { siteUrl, accessToken, pageId, expand = ['body.storage', 'version', 'space'] } = options;

  const url = buildConfluenceApiUrl(siteUrl, `/content/${pageId}`);
  const params = new URLSearchParams({
    expand: expand.join(','),
  });

  const response = await fetch(`${url}?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch Confluence page (${response.status}): ${body}`);
  }

  return (await response.json()) as ConfluencePage;
}

/**
 * Search Confluence using CQL (Confluence Query Language).
 * Returns paginated search results.
 */
export async function searchPages(options: SearchPagesOptions): Promise<SearchResults> {
  const { siteUrl, accessToken, cql, limit = 50, start = 0 } = options;

  const url = buildConfluenceApiUrl(siteUrl, '/search');
  const params = new URLSearchParams({
    cql,
    expand: 'body.storage,version',
    limit: limit.toString(),
    start: start.toString(),
  });

  const response = await fetch(`${url}?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to search Confluence pages (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    results: Array<{
      content?: ConfluencePage;
      links?: {
        webui?: string;
      };
    }>;
    start: number;
    limit: number;
    size: number;
    totalSize: number;
  };

  const results = data.results
    .filter(result => result.content)
    .map(result => {
      const page = result.content!;
      return {
        id: page.id,
        type: page.type,
        title: page.title,
        spaceKey: page.space.key,
        url: result.links?.webui || page.links.webui,
      };
    });

  return {
    results,
    start: data.start,
    limit: data.limit,
    size: data.size,
    totalSize: data.totalSize,
  };
}

/**
 * Get all pages from a space recursively.
 * Handles pagination automatically.
 */
export async function getAllPagesFromSpace(
  options: FetchPagesOptions
): Promise<ConfluencePageSummary[]> {
  const { siteUrl, accessToken, spaceKey, limit = 50 } = options;
  const allPages: ConfluencePageSummary[] = [];
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    const pages = await fetchPagesFromSpace({
      siteUrl,
      accessToken,
      spaceKey,
      limit,
      start,
    });

    allPages.push(...pages);

    // Check if we got fewer results than the limit (means we're at the end)
    if (pages.length < limit) {
      hasMore = false;
    } else {
      start += limit;
    }
  }

  return allPages;
}
