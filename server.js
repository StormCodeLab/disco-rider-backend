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

function logDebug(label, data = {}) {
  console.log(`[BIGDIG DEBUG] ${label}`, JSON.stringify(data, null, 2));
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function parseISO8601Duration(duration = '') {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  return (
    Number(match[1] || 0) * 3600 +
    Number(match[2] || 0) * 60 +
    Number(match[3] || 0)
  );
}

function normalizeText(text = '') {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanReleaseTitle(title = '') {
  return title
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBadYoutubeMatch(videoTitle = '', channelTitle = '') {
  const text = normalizeText(`${videoTitle} ${channelTitle}`);

  const badWords = [
    'vinyl collection',
    'record collection',
    'crate digging',
    'record player',
    'turntable',
    'phonograph',
    'gramophone',
    'putting a record',
    'playing a record',
    'vinyl setup',
    'dj setup',
    'unboxing',
    'reaction',
    'review',
    'tutorial',
    'how to',
    'samplette',
    'sampling',
    'sample pack',
    'karaoke',
    'cover version',
    'instrumental remake',
    'sped up',
    'slowed',
    'nightcore',
    'shorts',
    '#shorts',
    'interview',
    'documentary',
    'commercial',
    'advert',
  ];

  return badWords.some((word) => text.includes(word));
}

function isLikelyRemixOrLive(videoTitle = '') {
  const text = normalizeText(videoTitle);

  const badWords = [
    'remix',
    'edit',
    're edit',
    'bootleg',
    'mashup',
    'live',
    'concert',
    'cover',
    'karaoke',
    'instrumental',
  ];

  return badWords.some((word) => text.includes(word));
}

function getQueryWords(query = '') {
  return normalizeText(query)
    .split(/\s+/)
    .filter((word) => word.length > 3);
}

function titleMatchRatio(videoTitle, query) {
  const title = normalizeText(videoTitle);
  const words = getQueryWords(query);

  if (words.length === 0) return 0;

  const matched = words.filter((word) => title.includes(word));
  return matched.length / words.length;
}

function scoreYoutubeCandidate(video, query) {
  const title = normalizeText(video.youtubeTitle);
  const channel = normalizeText(video.youtubeChannel);

  let score = 0;

  const ratio = titleMatchRatio(video.youtubeTitle, query);

  score += ratio * 20;

  if (channel.includes('topic')) score += 12;
  if (title.includes('official audio')) score += 10;
  if (title.includes('provided to youtube')) score += 8;
  if (title.includes('official')) score += 5;
  if (title.includes('audio')) score += 5;
  if (title.includes('full album')) score += 3;
  if (title.includes('hq')) score += 2;
  if (title.includes('remaster')) score += 2;
  if (title.includes('vinyl')) score += 1;

  if (video.durationSeconds >= 90 && video.durationSeconds <= 600) score += 4;
  if (video.youtubeViews > 0) score += 1;

  if (isLikelyRemixOrLive(video.youtubeTitle)) score -= 10;
  if (title.includes('record')) score -= 4;
  if (title.includes('turntable')) score -= 10;
  if (title.includes('collection')) score -= 10;
  if (title.includes('review')) score -= 10;

  return score;
}

function getObscurityLabel(popularityViews) {
  if (!popularityViews || popularityViews < 5000) return 'Deep Dig';
  if (popularityViews < 50000) return 'Obscure';
  if (popularityViews < 250000) return 'Rare';
  if (popularityViews < 1000000) return 'Known';
  if (popularityViews < 10000000) return 'Popular';
  return 'Big Hit';
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
  params.append('page', String(Math.floor(Math.random() * 5) + 1));
  params.append('per_page', '50');
  params.append('token', process.env.DISCOGS_TOKEN);

  const url = `https://api.discogs.com/database/search?${params.toString()}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    logDebug('Discogs error', { error: data.error });
    return null;
  }

  if (!data.results || data.results.length === 0) {
    logDebug('No Discogs results', { filters });
    return null;
  }

  const filtered = data.results.filter((item) => item.title && item.year);

  if (filtered.length === 0) return null;

  const item = pickRandom(filtered);

  return {
    title: item.title,
    cleanTitle: cleanReleaseTitle(item.title),
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

async function fetchYoutubeVideos(searchQuery) {
  const searchParams = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: '10',
    q: searchQuery,
    key: process.env.YOUTUBE_API_KEY,
  });

  const searchUrl = `https://www.googleapis.com/youtube/v3/search?${searchParams.toString()}`;
  const searchResponse = await fetch(searchUrl);
  const searchData = await searchResponse.json();

  if (searchData.error) {
    logDebug('YouTube search error', {
      query: searchQuery,
      error: searchData.error,
    });
    return [];
  }

  if (!searchData.items || searchData.items.length === 0) {
    logDebug('YouTube search no items', { query: searchQuery });
    return [];
  }

  const ids = searchData.items.map((item) => item.id.videoId).filter(Boolean).join(',');
  if (!ids) return [];

  const detailsParams = new URLSearchParams({
    part: 'snippet,statistics,contentDetails,status',
    id: ids,
    key: process.env.YOUTUBE_API_KEY,
  });

  const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?${detailsParams.toString()}`;
  const detailsResponse = await fetch(detailsUrl);
  const detailsData = await detailsResponse.json();

  if (detailsData.error) {
    logDebug('YouTube details error', {
      ids,
      error: detailsData.error,
    });
    return [];
  }

  if (!detailsData.items || detailsData.items.length === 0) {
    logDebug('YouTube details no items', { ids });
    return [];
  }

  return detailsData.items.map((video) => {
    const durationSeconds = parseISO8601Duration(video.contentDetails?.duration || 'PT0S');

    return {
      youtubeId: video.id,
      youtubeTitle: video.snippet?.title || '',
      youtubeChannel: video.snippet?.channelTitle || '',
      youtubeThumb: video.snippet?.thumbnails?.high?.url,
      youtubeViews: Number(video.statistics?.viewCount || 0),
      durationSeconds,
      embeddable: video.status?.embeddable !== false,
    };
  });
}

async function findYoutubeVideo(query, filters) {
  const cleanQuery = cleanReleaseTitle(query);

  const searchQueries = [
    `${cleanQuery} official audio`,
    `${cleanQuery} topic`,
    `${cleanQuery} audio`,
    `${cleanQuery}`,
  ];

  let allVideos = [];

  for (const searchQuery of searchQueries) {
    const videos = await fetchYoutubeVideos(searchQuery);
    allVideos = [...allVideos, ...videos];
  }

  const uniqueVideos = Array.from(
    new Map(allVideos.map((video) => [video.youtubeId, video])).values()
  );

  const scoredVideos = uniqueVideos
    .map((video) => ({
      ...video,
      matchScore: scoreYoutubeCandidate(video, cleanQuery),
      matchRatio: titleMatchRatio(video.youtubeTitle, cleanQuery),
      badMatch: isBadYoutubeMatch(video.youtubeTitle, video.youtubeChannel),
      remixOrLive: isLikelyRemixOrLive(video.youtubeTitle),
    }))
    .sort((a, b) => b.matchScore - a.matchScore);

  const strictCandidates = scoredVideos.filter((video) => {
    const viewsOk = !filters.maxViews || video.youtubeViews <= filters.maxViews;
    const minViewsOk = !filters.minViews || video.youtubeViews >= filters.minViews;

    const durationOk =
      video.durationSeconds >= filters.minDuration &&
      video.durationSeconds <= filters.maxDuration;

    return (
      video.youtubeId &&
      video.embeddable &&
      viewsOk &&
      minViewsOk &&
      durationOk &&
      !video.badMatch &&
      !video.remixOrLive &&
      video.matchScore >= 7 &&
      video.matchRatio >= 0.35
    );
  });

  const relaxedCandidates = scoredVideos.filter((video) => {
    const viewsOk = !filters.maxViews || video.youtubeViews <= filters.maxViews;
    const minViewsOk = !filters.minViews || video.youtubeViews >= filters.minViews;

    const durationOk =
      video.durationSeconds >= filters.minDuration &&
      video.durationSeconds <= filters.maxDuration;

    return (
      video.youtubeId &&
      video.embeddable &&
      viewsOk &&
      minViewsOk &&
      durationOk &&
      !video.badMatch &&
      video.matchScore >= 3 &&
      video.matchRatio >= 0.2
    );
  });

  const chosenPool = strictCandidates.length > 0 ? strictCandidates : relaxedCandidates;

  if (chosenPool.length === 0) {
    logDebug('No YouTube candidates survived', {
      query,
      cleanQuery,
      totalVideosFound: uniqueVideos.length,
      filters,
      sampleVideos: scoredVideos.slice(0, 8).map((video) => ({
        title: video.youtubeTitle,
        channel: video.youtubeChannel,
        views: video.youtubeViews,
        duration: video.durationSeconds,
        embeddable: video.embeddable,
        badMatch: video.badMatch,
        remixOrLive: video.remixOrLive,
        score: video.matchScore,
        ratio: video.matchRatio,
      })),
    });

    return null;
  }

  const bestMatchScore = chosenPool[0].matchScore;

  const sameTrackCandidates = chosenPool.filter((video) => {
    return video.matchScore >= bestMatchScore - 4 && video.matchRatio >= 0.35;
  });

  const selectedVideo = sameTrackCandidates.sort(
    (a, b) => b.youtubeViews - a.youtubeViews
  )[0];

  const popularityViews = Math.max(
    ...sameTrackCandidates.map((video) => video.youtubeViews || 0)
  );

  return {
    ...selectedVideo,
    selectedVideoViews: selectedVideo.youtubeViews,
    popularityViews,
    obscurityLabel: getObscurityLabel(popularityViews),
    candidateCount: chosenPool.length,
  };
}

app.get('/sample', async (req, res) => {
  try {
    const filters = {
      genre: req.query.genre || '',
      style: req.query.style || 'Disco',
      region: req.query.region || '',
      yearFrom: Number(req.query.yearFrom || 1970),
      yearTo: Number(req.query.yearTo || 1985),
      minViews: req.query.minViews ? Number(req.query.minViews) : null,
      maxViews: req.query.maxViews ? Number(req.query.maxViews) : null,
      minDuration: Number(req.query.minDuration || 30),
      maxDuration: Number(req.query.maxDuration || 1200),
    };

    logDebug('Sample request', { filters });

    for (let i = 0; i < 25; i++) {
      const release = await findDiscogsRelease(filters);

      if (!release) {
        logDebug('No release found', { attempt: i + 1 });
        continue;
      }

      logDebug('Trying release', {
        attempt: i + 1,
        title: release.title,
        year: release.year,
      });

      const youtubeQuery = `${release.cleanTitle || release.title} ${release.year || ''}`;
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
      error: 'No matching music sample found',
      filters,
      hint: 'Try broader filters, a wider year range, lower minViews, or higher maxViews.',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Backend error' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`The Big Dig backend running on port ${PORT}`);
});