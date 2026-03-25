declare module 'search-engine-tool' {
  interface SearchEngineResult {
    title: string;
    url: string;
    description?: string;
  }

  interface SearchEngine {
    google(query: string, numResults?: number): Promise<SearchEngineResult[]>;
  }

  const google: SearchEngine;
  export default google;
}
