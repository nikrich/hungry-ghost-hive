// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildConfluenceApiUrl,
  fetchPagesFromSpace,
  getAllPagesFromSpace,
  getPage,
  searchPages,
  type ConfluencePage,
} from './client.js';

// Mock fetch globally
global.fetch = vi.fn();

const mockSiteUrl = 'https://mycompany.atlassian.net';
const mockAccessToken = 'test-access-token';
const mockSpaceKey = 'TEST';

const mockPage: ConfluencePage = {
  id: '123',
  type: 'page',
  title: 'Test Page',
  space: {
    key: 'TEST',
    name: 'Test Space',
  },
  body: {
    storage: {
      value: '<p>Test content</p>',
      representation: 'storage',
    },
  },
  links: {
    self: 'https://mycompany.atlassian.net/wiki/rest/api/content/123',
    webui: 'https://mycompany.atlassian.net/wiki/spaces/TEST/pages/123',
  },
  version: {
    number: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Confluence Client', () => {
  describe('buildConfluenceApiUrl', () => {
    it('should build API URL with trailing slash', () => {
      const url = buildConfluenceApiUrl('https://mycompany.atlassian.net/', '/content');
      expect(url).toBe('https://mycompany.atlassian.net/wiki/rest/api/content');
    });

    it('should build API URL without trailing slash', () => {
      const url = buildConfluenceApiUrl('https://mycompany.atlassian.net', '/content');
      expect(url).toBe('https://mycompany.atlassian.net/wiki/rest/api/content');
    });

    it('should build search endpoint URL', () => {
      const url = buildConfluenceApiUrl(mockSiteUrl, '/search');
      expect(url).toBe('https://mycompany.atlassian.net/wiki/rest/api/search');
    });
  });

  describe('fetchPagesFromSpace', () => {
    it('should fetch pages from a space', async () => {
      const mockResponse = {
        results: [mockPage],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const pages = await fetchPagesFromSpace({
        siteUrl: mockSiteUrl,
        accessToken: mockAccessToken,
        spaceKey: mockSpaceKey,
      });

      expect(pages).toHaveLength(1);
      expect(pages[0]).toEqual({
        id: '123',
        type: 'page',
        title: 'Test Page',
        spaceKey: 'TEST',
        url: 'https://mycompany.atlassian.net/wiki/spaces/TEST/pages/123',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/wiki/rest/api/content'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockAccessToken}`,
            Accept: 'application/json',
          }),
        })
      );
    });

    it('should handle pagination options', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      });

      await fetchPagesFromSpace({
        siteUrl: mockSiteUrl,
        accessToken: mockAccessToken,
        spaceKey: mockSpaceKey,
        limit: 25,
        start: 50,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=25'),
        expect.any(Object)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('start=50'),
        expect.any(Object)
      );
    });

    it('should throw error on failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(
        fetchPagesFromSpace({
          siteUrl: mockSiteUrl,
          accessToken: mockAccessToken,
          spaceKey: mockSpaceKey,
        })
      ).rejects.toThrow('Failed to fetch Confluence pages (401)');
    });
  });

  describe('getPage', () => {
    it('should get a page by ID', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPage,
      });

      const page = await getPage({
        siteUrl: mockSiteUrl,
        accessToken: mockAccessToken,
        pageId: '123',
      });

      expect(page).toEqual(mockPage);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/wiki/rest/api/content/123'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockAccessToken}`,
          }),
        })
      );
    });

    it('should expand specified fields', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockPage,
      });

      await getPage({
        siteUrl: mockSiteUrl,
        accessToken: mockAccessToken,
        pageId: '123',
        expand: ['body.storage', 'ancestors'],
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('expand=body.storage%2Cancestors'),
        expect.any(Object)
      );
    });

    it('should throw error on failed response', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });

      await expect(
        getPage({
          siteUrl: mockSiteUrl,
          accessToken: mockAccessToken,
          pageId: '999',
        })
      ).rejects.toThrow('Failed to fetch Confluence page (404)');
    });
  });

  describe('searchPages', () => {
    it('should search pages using CQL', async () => {
      const mockSearchResponse = {
        results: [
          {
            content: mockPage,
            links: {
              webui: 'https://mycompany.atlassian.net/wiki/spaces/TEST/pages/123',
            },
          },
        ],
        start: 0,
        limit: 50,
        size: 1,
        totalSize: 1,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSearchResponse,
      });

      const results = await searchPages({
        siteUrl: mockSiteUrl,
        accessToken: mockAccessToken,
        cql: 'type = page AND space = TEST',
      });

      expect(results.results).toHaveLength(1);
      expect(results.totalSize).toBe(1);
      expect(results.results[0]).toEqual({
        id: '123',
        type: 'page',
        title: 'Test Page',
        spaceKey: 'TEST',
        url: 'https://mycompany.atlassian.net/wiki/spaces/TEST/pages/123',
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/wiki/rest/api/search'),
        expect.any(Object)
      );
    });

    it('should handle pagination options in search', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [],
          start: 100,
          limit: 20,
          size: 0,
          totalSize: 0,
        }),
      });

      await searchPages({
        siteUrl: mockSiteUrl,
        accessToken: mockAccessToken,
        cql: 'type = page',
        limit: 20,
        start: 100,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=20'),
        expect.any(Object)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('start=100'),
        expect.any(Object)
      );
    });

    it('should throw error on failed search', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      });

      await expect(
        searchPages({
          siteUrl: mockSiteUrl,
          accessToken: mockAccessToken,
          cql: 'invalid cql',
        })
      ).rejects.toThrow('Failed to search Confluence pages (400)');
    });
  });

  describe('getAllPagesFromSpace', () => {
    it('should fetch all pages with pagination', async () => {
      const page2 = { ...mockPage, id: '124', title: 'Test Page 2' };
      const page3 = { ...mockPage, id: '125', title: 'Test Page 3' };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [mockPage, page2] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ results: [page3] }),
        });

      const allPages = await getAllPagesFromSpace({
        siteUrl: mockSiteUrl,
        accessToken: mockAccessToken,
        spaceKey: mockSpaceKey,
        limit: 2,
      });

      expect(allPages).toHaveLength(3);
      expect(allPages[0].id).toBe('123');
      expect(allPages[1].id).toBe('124');
      expect(allPages[2].id).toBe('125');

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should stop pagination when fewer results than limit', async () => {
      const page2 = { ...mockPage, id: '124', title: 'Test Page 2' };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [mockPage, page2] }),
      });

      const allPages = await getAllPagesFromSpace({
        siteUrl: mockSiteUrl,
        accessToken: mockAccessToken,
        spaceKey: mockSpaceKey,
        limit: 50,
      });

      expect(allPages).toHaveLength(2);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
