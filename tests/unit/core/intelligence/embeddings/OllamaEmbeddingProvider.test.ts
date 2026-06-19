import { OllamaEmbeddingProvider } from '../../../../../src/core/intelligence/embeddings/OllamaEmbeddingProvider';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('OllamaEmbeddingProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('reports available when server and model are present', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: 'nomic-embed-text:latest' }] }),
    });

    const provider = new OllamaEmbeddingProvider({ baseUrl: 'http://localhost:11434', model: 'nomic-embed-text' });
    expect(await provider.isAvailable()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags', { method: 'GET' });
  });

  it('reports unavailable when model is missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2:latest' }] }),
    });

    const provider = new OllamaEmbeddingProvider({ baseUrl: 'http://localhost:11434', model: 'nomic-embed-text' });
    expect(await provider.isAvailable()).toBe(false);
  });

  it('reports unavailable when server is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const provider = new OllamaEmbeddingProvider({ baseUrl: 'http://localhost:11434', model: 'nomic-embed-text' });
    expect(await provider.isAvailable()).toBe(false);
  });

  it('embeds text using the configured model', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });

    const provider = new OllamaEmbeddingProvider({ baseUrl: 'http://localhost:11434', model: 'nomic-embed-text' });
    const results = await provider.embed(['hello']);
    expect(results).toEqual([[0.1, 0.2, 0.3]]);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'hello' }),
      }),
    );
  });

  it('throws on non-ok embedding response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => 'model not found',
    });

    const provider = new OllamaEmbeddingProvider({ baseUrl: 'http://localhost:11434', model: 'nomic-embed-text' });
    await expect(provider.embed(['hello'])).rejects.toThrow('Ollama embedding failed (404 Not Found)');
  });
});
