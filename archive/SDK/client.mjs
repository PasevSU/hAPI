/** Browser/Node 20+ read-only client for the per-portal REST API. */
export class PortalClient {
  constructor({baseUrl, slug, apiKey, fetchImpl = fetch}) {
    if (!/^https?:\/\//.test(baseUrl) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw new TypeError('Invalid base URL or slug');
    this.baseUrl = baseUrl.replace(/\/$/, ''); this.slug = slug; this.apiKey = apiKey; this.fetchImpl = fetchImpl;
  }
  async request(suffix) {
    const endpoint = `${this.baseUrl}/api/v1/p/${this.slug}${suffix}`;
    const headers = this.apiKey ? {Authorization: `Bearer ${this.apiKey}`} : {};
    const response = await this.fetchImpl(endpoint, {headers});
    if (!response.ok) throw new Error(`Portal API returned HTTP ${response.status}`);
    return response.json();
  }
  info() {return this.request('');}
  files({q='',limit=50,offset=0,order='name',direction='asc'}={}) {
    const p = new URLSearchParams({q,limit:String(limit),offset:String(offset),order,direction});
    return this.request(`/files?${p}`);
  }
  file(id) {return this.request(`/files/${encodeURIComponent(id)}`);}
  manifest() {return this.request('/manifest');}
  openapi() {return this.request('/openapi.json');}
  async download(id) {
    const response = await this.fetchImpl(`${this.baseUrl}/api/v1/p/${this.slug}/files/${encodeURIComponent(id)}/download`,{headers:this.apiKey?{Authorization:`Bearer ${this.apiKey}`}:{}});
    if (!response.ok) throw new Error(`Download failed HTTP ${response.status}`);
    return response.arrayBuffer();
  }
}
