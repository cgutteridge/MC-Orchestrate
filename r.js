const fetch = require('node-fetch');
const xml2js = require('xml2js');

async function getFirstItemTitleFromRSS(url) {
  try {
    const response = await fetch(url);
    const rssText = await response.text();
    const rssObj = await xml2js.parseStringPromise(rssText);
    const firstItemTitle = rssObj.rss.channel[0].item[0].title[0];
    return firstItemTitle;
  } catch (error) {
    console.error('Error fetching or parsing RSS:', error);
    return null;
  }
}

// Example usage
const rssUrl = 'https://your-rss-feed-url-here';
getFirstItemTitleFromRSS(rssUrl).then(title => console.log(title));
