require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3001;

const REGION_TO_COUNTRIES = {
  Europe: ['UK', 'Germany', 'France', 'Italy', 'Netherlands', 'Spain', 'Belgium', 'Sweden'],
  'North America': ['US', 'Canada'],
  'Latin America': ['Brazil', 'Mexico', 'Argentina', 'Colombia', 'Venezuela'],
  Africa: ['Nigeria', 'Ghana', 'South Africa', 'Ethiopia', 'Kenya'],
  Asia: ['Japan', 'India', 'Thailand', 'Indonesia', 'Philippines'],
  Oceania: ['Australia', 'New Zealand'],
};

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function parseISO8601Duration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);

  return hours * 3600 + minutes * 60 + seconds;
}

async function findDiscogsRelease(filters) {
  const { genre, style, region, yearFrom, yearTo } = filters;

  const randomYear =
    Math.floor(Math.random() * (yearTo - yearFrom + 1)) + yearFrom;

  const countries = REGION_TO_COUNTRIES[region] || [];
  const randomCountry = countries.length ? pickRandom(countries) : null;

  const params = new URLSearchParams();

  if (genre) params.append('genre', genre);
  if (style) params.append('style', style);
  if (randomCountry) params.append('country', randomCountry);

  params.append('year', String(randomYear));
  params.append('type', 'release');
  params.append('page', String(Math.floor(Math.random() * 3) + 1));
  params.append('per_page', '50');
  params.append('token', process.env.DISCOGS_TOKEN);

  const url = `https://api.discogs.com/database/search?${params.toString()}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!data.results || data.results.length === 0) return null;

  const item = pickRandom(data.results);

  return {
    title: item.title,
    year: item.year,
    country: item.country,
    genre: item.genre,
    style: item.style,
    thumb: item.thumb,
    discogsUrl: item.uri ? `https://www.discogs.com${item.uri}` : null,
    searched: {
      genre,
      style,
      region,
      country: randomCountry,
      year: randomYear,
    },
  };
}

async function findYoutubeVideo(query, filters) {
  const searchParams = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: '5',
    q: query,
    key: process.env.YOUTUBE_API_KEY,
  });

  const searchUrl =
    `https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`;

  const searchResponse = await fetch(searchUrl);
  const searchData = await searchResponse.json();

  if (!searchData.items || searchData.items.length === 0) return null;

  const ids = searchData.items.map((item) => item.id.videoId).join(',');

  const detailsParams = new URLSearchParams({
    part: 'snippet,statistics,contentDetails',
    id: ids,
    key: process.env.YOUTUBE_API_KEY,
  });

  const detailsUrl =
    `https://www.googleapis.com/youtube/v3/videos?${detailsParams.toString()}`;

  const detailsResponse = await fetch(detailsUrl);
  const detailsData = await detailsResponse.json();

  if (!detailsData.items || detailsData.items.length === 0) return null;

  const candidates = detailsData.items
    .map((video) => {
      const durationSeconds = parseISO8601Duration(video.contentDetails?.duration || 'PT0S');

      return {
        youtubeId: video.id,
        youtubeTitle: video.snippet.title,
        youtubeChannel: video.snippet.channelTitle,
        youtubeThumb: video.snippet.thumbnails?.high?.url,
        youtubeViews: Number(video.statistics?.viewCount || 0),
        durationSeconds,
      };
    })
    .filter((video) => {
      const viewsOk = !filters.maxViews || video.youtubeViews <= filters.maxViews;
      const durationOk =
        video.durationSeconds >= filters.minDuration &&
        video.durationSeconds <= filters.maxDuration;

      return viewsOk && durationOk;
    });

  if (candidates.length === 0) return null;

  return pickRandom(candidates);
}

app.get('/sample', async (req, res) => {
  try {
    const filters = {
      genre: req.query.genre || '',
      style: req.query.style || 'Disco',
      region: req.query.region || '',
      yearFrom: Number(req.query.yearFrom || 1970),
      yearTo: Number(req.query.yearTo || 1985),
      maxViews: req.query.maxViews ? Number(req.query.maxViews) : null,
      minDuration: Number(req.query.minDuration || 30),
      maxDuration: Number(req.query.maxDuration || 1200),
    };

    for (let i = 0; i < 10; i++) {
      const release = await findDiscogsRelease(filters);
      if (!release) continue;

      const youtubeQuery = `${release.title} ${release.year || ''}`;
      const youtube = await findYoutubeVideo(youtubeQuery, filters);

      if (!youtube) continue;

      return res.json({
        ...release,
        youtubeQuery,
        ...youtube,
        filters,
      });
    }

    res.status(404).json({
      error: 'No matching sample found',
      filters,
      hint: 'Try broader filters, a wider year range, or higher maxViews.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Backend error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`The Big Dig backend running on port ${PORT}`);
});