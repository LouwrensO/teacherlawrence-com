// _unsplash.js — shared helper for fetching one relevant photo from
// Unsplash. Used by lesson-CREATION flows (generate.js, make.js) so a
// new lesson is saved with its photo already attached, instead of
// waiting for someone to view it or for a backfill run.
export async function fetchUnsplashPhoto(query, key) {
  if (!key || !query || !query.trim()) return null;
  try {
    const api = "https://api.unsplash.com/search/photos?per_page=1&orientation=landscape&content_filter=high&query="
      + encodeURIComponent(query);
    const r = await fetch(api, { headers: { Authorization: "Client-ID " + key } });
    if (!r.ok) return null;
    const data = await r.json();
    const photo = data && data.results && data.results[0];
    if (!photo) return null;
    return {
      url: photo.urls && (photo.urls.regular || photo.urls.small),
      alt: photo.alt_description || query,
      credit: {
        name: photo.user && photo.user.name,
        link: photo.user && photo.user.links && photo.user.links.html
      }
    };
  } catch (e) {
    return null;
  }
}
